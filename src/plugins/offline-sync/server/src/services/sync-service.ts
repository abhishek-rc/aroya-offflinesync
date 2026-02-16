export default ({ strapi: strapiInstance }: { strapi: any }) => {
  // Explicitly capture strapi in closure to ensure it's available in async callbacks
  const strapi = strapiInstance;

  return {
    /**
     * Push pending operations to master
     */
    async push(): Promise<{ pushed: number; failed: number }> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'replica') {
        throw new Error('Push sync only available in replica mode');
      }

      const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
      const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
      const documentMapping = strapi.plugin('offline-sync').service('document-mapping');
      const mediaSync = strapi.plugin('offline-sync').service('media-sync');

      let pushed = 0;
      let failed = 0;

      try {
        // Get pending operations
        const pending = await syncQueue.dequeue(config.shipId, config.sync.batchSize);

        strapi.log.info(`Pushing ${pending.length} operations to master...`);

        for (const operation of pending) {
          try {
            let operationData = operation.data;
            let fileRecords: any[] = [];

            // If media sync is enabled, prepare media files for push
            // This uploads files from MinIO to OSS and collects file records
            if (mediaSync.isEnabled() && operationData && operation.operation !== 'delete') {
              try {
                const mediaPrep = await mediaSync.prepareContentForMasterPush(operationData);
                fileRecords = mediaPrep.fileRecords;

                if (mediaPrep.fileSyncResult.failed > 0) {
                  strapi.log.warn(`[Push] ${mediaPrep.fileSyncResult.failed} media files failed to sync to OSS`);
                }
              } catch (mediaPrepError: any) {
                strapi.log.warn(`[Push] Media preparation failed: ${mediaPrepError.message}`);
                // Continue without media - content might still sync
              }
            }

            const message: any = {
              messageId: `msg-${Date.now()}-${operation.id}`,
              shipId: config.shipId,
              timestamp: new Date().toISOString(),
              operation: operation.operation,
              contentType: operation.content_type,
              contentId: operation.content_id,
              version: operation.local_version,
              data: operationData,
              metadata: {
                queueId: operation.id,
              },
            };

            // Include file records if any (for master to create file entries)
            if (fileRecords.length > 0) {
              message.fileRecords = fileRecords;
              strapi.log.info(`[Push] Including ${fileRecords.length} file records in message`);
            }

            // Include locale if present (for i18n support)
            if (operation.locale) {
              message.locale = operation.locale;
            }

            // For UPDATE/DELETE operations, include masterDocumentId if we have a mapping
            // This helps Master identify the document even if it doesn't have the mapping yet
            if (operation.operation !== 'create') {
              try {
                const masterDocId = await documentMapping.getMasterDocumentId(
                  config.shipId,
                  operation.content_type,
                  operation.content_id
                );
                if (masterDocId) {
                  message.masterDocumentId = masterDocId;
                  strapi.log.debug(`[Push] Including masterDocumentId: ${masterDocId} for ${operation.content_id}`);
                }
              } catch (mappingError: any) {
                strapi.log.debug(`[Push] No mapping found for ${operation.content_id}: ${mappingError.message}`);
              }
            }

            await kafkaProducer.send(message);
            // Mark as 'synced' - Kafka guarantees delivery, so once sent we can consider it synced
            await syncQueue.markSynced(operation.id);
            pushed++;
          } catch (error: any) {
            strapi.log.error(`Failed to push operation ${operation.id}: ${error.message}`);
            await syncQueue.markFailed(operation.id, error);
            failed++;
          }
        }

        strapi.log.info(`Push completed: ${pushed} pushed, ${failed} failed`);

        return { pushed, failed };
      } catch (error: any) {
        strapi.log.error(`Push sync error: ${error.message}`);
        throw error;
      }
    },

    /**
     * Pull updates from master
     * In bi-directional sync, ships subscribe to master-updates topic
     * This method is called when ship comes online to catch up on missed updates
     */
    async pull(): Promise<{ pulled: number; conflicts: number }> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'replica') {
        throw new Error('Pull sync only available in replica mode');
      }

      // Pull is now handled by Kafka consumer subscribing to master-updates topic
      // This method can be used for on-demand sync or initial data load

      // For now, just log that pull sync is handled via Kafka subscription
      strapi.log.info('[Sync] Pull sync is handled via Kafka subscription to master-updates topic');

      // Return current stats (could be enhanced with actual pull tracking)
      return { pulled: 0, conflicts: 0 };
    },

    /**
     * Clean data for sync - remove internal Strapi fields
     */
    cleanSyncData(data: Record<string, unknown>): Record<string, unknown> {
      if (!data || typeof data !== 'object') return data;

      const internalFields = [
        'id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt',
        'createdBy', 'updatedBy', 'locale', 'localizations',
      ];

      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (!internalFields.includes(key)) {
          cleaned[key] = value;
        }
      }
      return cleaned;
    },

    /**
     * Process ship update (master side)
     * Conflict detection: checks if master was modified since last sync from this ship
     */
    async processShipUpdate(message: any): Promise<void> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'master') {
        throw new Error('processShipUpdate only available in master mode');
      }

      // Validate message
      const { messageId, contentType, contentId: replicaDocumentId, version: shipVersion, data, operation, shipId, timestamp } = message;
      if (!contentType || !replicaDocumentId || !shipId) {
        strapi.log.warn('[Sync] Invalid message: missing required fields');
        return;
      }

      const messageTracker = strapi.plugin('offline-sync').service('message-tracker');
      const documentMapping = strapi.plugin('offline-sync').service('document-mapping');
      const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');
      const deadLetter = strapi.plugin('offline-sync').service('dead-letter');
      const conflictResolver = strapi.plugin('offline-sync').service('conflict-resolver');

      // Idempotency check - skip if already processed
      if (messageId) {
        const alreadyProcessed = await messageTracker.isProcessed(messageId);
        if (alreadyProcessed) {
          strapi.log.debug(`[Sync] Duplicate message skipped: ${messageId}`);
          return;
        }
      }

      // Register ship (non-blocking, but log errors for debugging)
      shipTracker.registerShip(shipId, shipId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        strapi.log.warn(`[Sync] Failed to register ship ${shipId} (non-blocking): ${message}`);
        // Don't throw - this is non-blocking, but we log it for debugging
      });

      // Set flag to prevent Document Service middleware from re-broadcasting these changes
      // This prevents infinite sync loops (ship->master->ship->...)
      (strapi as any)._offlineSyncFromShip = true;

      try {
        // Validate content type exists
        const model = strapi.contentTypes[contentType];
        if (!model) {
          strapi.log.warn(`[Sync] Unknown content type: ${contentType}`);
          if (messageId) await messageTracker.markFailed(messageId);
          return;
        }

        // Clean data - remove internal fields
        let cleanedData = this.cleanSyncData(data || {});

        // Transform media URLs from replica (MinIO) to master (OSS)
        const mediaSync = strapi.plugin('offline-sync').service('media-sync');

        // IMPORTANT: Process file records FIRST before content
        // This creates the plugin::upload.file entries that content may reference
        let fileIdMapping = new Map<number, number>();
        if (message.fileRecords && message.fileRecords.length > 0) {
          strapi.log.info(`[Sync] 📥 Processing ${message.fileRecords.length} file records from replica...`);
          try {
            fileIdMapping = await mediaSync.processReplicaFileRecords(message.fileRecords);

            // Update content data with new file IDs
            if (fileIdMapping.size > 0) {
              cleanedData = mediaSync.updateContentFileIds(cleanedData, fileIdMapping);
              strapi.log.info(`[Sync] ✅ Updated content with ${fileIdMapping.size} file ID mappings`);
            }
          } catch (fileRecordError: any) {
            strapi.log.error(`[Sync] Failed to process file records: ${fileRecordError.message}`);
            // Continue anyway - content might still be valid without media
          }
        }

        // Transform remaining media URLs from replica (MinIO) to master (OSS)
        if (mediaSync.isEnabled()) {
          cleanedData = mediaSync.transformToMaster(cleanedData);
        }

        // Get master documentId - first check if provided in message, then lookup from mapping
        let masterDocumentId: string | null = null;
        let masterDocIdFromMessage = false; // Track if we got it from message (need to create mapping later)

        // Priority 1: Use masterDocumentId from message (Replica sends this for existing content)
        if (message.masterDocumentId) {
          masterDocumentId = message.masterDocumentId;
          masterDocIdFromMessage = true;
          strapi.log.debug(`[Sync] Using masterDocumentId from message: ${masterDocumentId}`);
          // NOTE: Do NOT update mapping here - must wait until AFTER conflict detection
        }

        // Priority 2: Lookup from Master's mapping table
        if (!masterDocumentId) {
          masterDocumentId = await documentMapping.getMasterDocumentId(
            shipId,
            contentType,
            replicaDocumentId
          );
        }

        // Handle operations
        if (operation === 'delete') {
          if (masterDocumentId) {
            // Use locale if provided (for locale-specific deletes)
            const deleteOptions: any = { documentId: masterDocumentId };
            if (message.locale) {
              deleteOptions.locale = message.locale;
              strapi.log.info(`[Sync] 🗑️ Deleting ${contentType} locale=${message.locale} (replica: ${replicaDocumentId})`);
            }

            await strapi.documents(contentType).delete(deleteOptions);

            // Only delete mapping if ALL locales were deleted (no specific locale)
            if (!message.locale) {
              await documentMapping.deleteMapping(shipId, contentType, replicaDocumentId);
            }
            strapi.log.info(`[Sync] ✅ Deleted ${contentType}${message.locale ? ` [${message.locale}]` : ''} (replica: ${replicaDocumentId})`);
          } else {
            strapi.log.debug(`[Sync] Delete skipped - no mapping for ${replicaDocumentId}`);
          }
        } else if (operation === 'create' && masterDocumentId && message.locale) {
          // SPECIAL CASE: Adding a new locale to an existing document
          // Mapping exists (masterDocumentId found) + locale specified = new locale for existing doc
          strapi.log.info(`[Sync] 🌐 Adding locale ${message.locale} to existing ${contentType} (master: ${masterDocumentId})`);

          await strapi.documents(contentType).update({
            documentId: masterDocumentId,
            locale: message.locale,
            data: cleanedData,
            status: 'published',
          });

          strapi.log.info(`[Sync] ✅ Added locale ${message.locale} to ${contentType}: ${replicaDocumentId} -> ${masterDocumentId}`);

        } else if (operation === 'create' && masterDocumentId) {
          // CREATE with existing mapping - this is likely adding content to existing doc
          // Just update the existing document
          strapi.log.info(`[Sync] 📝 Create with existing mapping - updating ${contentType} (master: ${masterDocumentId})`);

          await strapi.documents(contentType).update({
            documentId: masterDocumentId,
            locale: message.locale || undefined,
            data: cleanedData,
            status: 'published',
          });

          // Update mapping
          await documentMapping.setMapping(shipId, contentType, replicaDocumentId, masterDocumentId, shipId);

          strapi.log.info(`[Sync] ✅ Updated existing ${contentType}: ${replicaDocumentId} -> ${masterDocumentId}`);

        } else if (operation === 'create') {
          // CREATE with NO mapping - truly new content
          const createOptions: any = {
            data: cleanedData,
            status: 'published',
          };

          if (message.locale) {
            createOptions.locale = message.locale;
          }

          const created = await strapi.documents(contentType).create(createOptions);

          if (created?.documentId) {
            await documentMapping.setMapping(shipId, contentType, replicaDocumentId, created.documentId, shipId);

            const masterSyncQueue = strapi.plugin('offline-sync').service('master-sync-queue');
            await masterSyncQueue.logEdit({
              contentType,
              documentId: created.documentId,
              operation: 'create',
              editedBy: `ship-${shipId}`,
            });

            strapi.log.info(`[Sync] ✅ Created ${contentType}${message.locale ? ` [${message.locale}]` : ''}: ${replicaDocumentId} -> ${created.documentId}`);

            const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
            if (kafkaProducer.isConnected()) {
              await kafkaProducer.sendCreateAck({
                shipId,
                contentType,
                replicaDocumentId,
                masterDocumentId: created.documentId,
                locale: message.locale || null,
              });
            }
          }
        } else if (operation === 'update' && !masterDocumentId) {
          // UPDATE with NO mapping - this should not happen if initial sync was done properly
          // Log error and skip - do NOT create duplicate entries
          strapi.log.error(`[Sync] ❌ UPDATE without mapping for ${contentType} (${replicaDocumentId}) - Initial sync required!`);
          strapi.log.error(`[Sync] ❌ Please run initial sync API: POST /api/offline-sync/initial-sync`);

          // Add to dead letter for manual review
          await deadLetter.add({
            messageId: messageId || `no-mapping-${Date.now()}`,
            shipId,
            contentType,
            contentId: replicaDocumentId,
            operation,
            payload: { data: cleanedData, locale: message.locale },
            error: new Error(`No mapping found for UPDATE operation. Run initial sync first.`),
            maxRetries: 0, // Don't retry - needs manual intervention
          });

          if (messageId) {
            await messageTracker.markFailed(messageId);
          }
          return; // Skip - requires initial sync
        } else {
          // UPDATE - Check for conflicts using multiple sources
          const mapping = await documentMapping.getMapping(shipId, contentType, replicaDocumentId);
          const lastSyncedAt = mapping?.updatedAt ? new Date(mapping.updatedAt) : null;
          const lastSyncedBy = mapping?.lastSyncedBy || null;

          // Get current master document (include locale for i18n-aware conflict detection)
          const findOptions: any = { documentId: masterDocumentId };
          if (message.locale) {
            findOptions.locale = message.locale;
          }
          const masterDoc = await strapi.documents(contentType).findOne(findOptions);
          const masterUpdatedAt = masterDoc?.updatedAt ? new Date(masterDoc.updatedAt) : null;

          // IMPORTANT: If the specific locale doesn't exist on master, this is a NEW locale
          // No conflict possible - just create/update the new locale
          const isNewLocale = message.locale && !masterDoc;
          if (isNewLocale) {
            strapi.log.info(`[Sync] 🌐 Adding new locale ${message.locale} to existing ${contentType} (master: ${masterDocumentId})`);

            await strapi.documents(contentType).update({
              documentId: masterDocumentId,
              locale: message.locale,
              data: cleanedData,
              status: 'published',
            });

            // Update the mapping
            await documentMapping.setMapping(shipId, contentType, replicaDocumentId, masterDocumentId, shipId);

            strapi.log.info(`[Sync] ✅ Added locale ${message.locale} to ${contentType} (master: ${masterDocumentId})`);

            // Mark message as processed and return early
            if (messageId) {
              await messageTracker.markProcessed(messageId, { shipId, contentType, contentId: replicaDocumentId, operation, locale: message.locale });
            }
            return;
          }

          // Check if Master was directly edited by admin (using master_edit_log)
          const masterSyncQueue = strapi.plugin('offline-sync').service('master-sync-queue');
          const masterDirectEdit = await masterSyncQueue.getLastEditor(contentType, masterDocumentId);

          // Conflict Detection (Production-Ready):
          let hasConflict = false;
          let conflictSource = '';

          // Case A: masterDocumentId came from message (no mapping on Master yet)
          // This happens for existing content after initial sync
          if (masterDocIdFromMessage && !mapping) {
            // No mapping on Master - check ONLY master_edit_log
            // If Master admin edited, it's a conflict
            if (masterDirectEdit && masterDirectEdit.editedBy === 'master-admin') {
              hasConflict = true;
              conflictSource = 'master-admin (no mapping, first sync after initial sync)';
              strapi.log.debug(`[Sync] Conflict: No mapping exists, master_edit_log shows admin edited`);
            }
            // If last editor was a ship or no edit log, no conflict (allow first sync)
          } else {
            // Case B: Normal flow - mapping exists on Master
            // Case 1: Master was modified after last sync by a DIFFERENT ship
            const masterModifiedAfterSync = lastSyncedAt && masterUpdatedAt && masterUpdatedAt > lastSyncedAt;
            const differentShipModified = lastSyncedBy !== shipId;

            // Case 2: Master was directly edited by admin after last sync
            const masterAdminEdited = masterDirectEdit &&
              masterDirectEdit.editedBy === 'master-admin' &&
              lastSyncedAt &&
              masterDirectEdit.editedAt > lastSyncedAt;

            // Trigger conflict if:
            // 1. Master was modified after last sync by DIFFERENT source (ship or admin)
            // 2. OR Master admin directly edited after last sync
            hasConflict = (masterModifiedAfterSync && differentShipModified) || masterAdminEdited;

            if (hasConflict) {
              conflictSource = masterAdminEdited ? 'master-admin' : `ship (lastSyncedBy=${lastSyncedBy})`;
            }
          }

          strapi.log.debug(`[Sync] Conflict check: hasConflict=${hasConflict}, masterDocIdFromMessage=${masterDocIdFromMessage}, mappingExists=${!!mapping}`);

          if (hasConflict) {
            strapi.log.debug(`[Sync] Conflict detected: source=${conflictSource}, currentShip=${shipId}`);

            const isMasterAdminConflict = conflictSource.includes('master-admin');

            // Log conflict for admin resolution
            const conflictLog = await conflictResolver.logConflict({
              contentType,
              contentId: masterDocumentId,
              shipId,
              shipVersion: shipVersion || 0,
              masterVersion: 0, // Not using versions anymore
              shipData: cleanedData,
              masterData: this.cleanSyncData(masterDoc || {}),
              conflictType: isMasterAdminConflict ? 'master-admin-edit' : 'concurrent-edit',
            });

            const conflictReason = isMasterAdminConflict
              ? 'Master was directly edited by admin - both sides made changes while offline'
              : 'Master was edited by another ship after last sync';

            strapi.log.warn(`[Sync] ⚠️ CONFLICT: ${contentType} (${masterDocumentId}) - ${conflictReason}`);

            // Send conflict notification back to replica
            const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
            if (kafkaProducer.isConnected()) {
              await kafkaProducer.sendConflictNotification({
                shipId,
                contentType,
                contentId: masterDocumentId,
                replicaDocumentId,
                conflictId: conflictLog?.id || 0,
                reason: conflictReason,
                masterData: this.cleanSyncData(masterDoc || {}),
                shipData: cleanedData,
                queueId: message.metadata?.queueId,
              });
            }

            // If masterDocumentId came from message, still create mapping for future syncs
            // (so conflict resolution can work properly)
            if (masterDocIdFromMessage) {
              await documentMapping.setMapping(shipId, contentType, replicaDocumentId, masterDocumentId, shipId);
            }

            if (messageId) {
              await messageTracker.markProcessed(messageId, { shipId, contentType, contentId: replicaDocumentId, operation, conflict: true });
            }
            return; // Don't apply - needs resolution
          }

          // No conflict - apply update and publish
          const updateOptions: any = {
            documentId: masterDocumentId,
            data: cleanedData,
            status: 'published',
          };

          // Include locale for i18n support - critical for locale-specific updates
          if (message.locale) {
            updateOptions.locale = message.locale;
          }

          await strapi.documents(contentType).update(updateOptions);

          // Update the mapping timestamp and lastSyncedBy (for conflict detection)
          await documentMapping.setMapping(shipId, contentType, replicaDocumentId, masterDocumentId, shipId);

          // Clear master edit log (ship sync takes over as latest modifier)
          await masterSyncQueue.logEdit({
            contentType,
            documentId: masterDocumentId,
            operation: 'update',
            editedBy: `ship-${shipId}`,
          });

          strapi.log.info(`[Sync] ✅ Updated ${contentType}${message.locale ? ` [${message.locale}]` : ''} (master: ${masterDocumentId})`);
        }

        // Mark message as processed
        if (messageId) {
          await messageTracker.markProcessed(messageId, { shipId, contentType, contentId: replicaDocumentId, operation });
        }

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (messageId) await messageTracker.markFailed(messageId);

        await deadLetter.add({
          messageId: messageId || `unknown-${Date.now()}`,
          shipId,
          contentType,
          contentId: replicaDocumentId,
          operation,
          payload: { version: shipVersion, data },
          error: error instanceof Error ? error : new Error(errorMessage),
          maxRetries: 3,
        });

        strapi.log.error(`[Sync] Error: ${contentType}:${replicaDocumentId} - ${errorMessage}`);
      } finally {
        // Always reset the flag to allow normal master changes to be broadcast
        (strapi as any)._offlineSyncFromShip = false;
      }
    },

    /**
     * Process master update (replica side)
     * Called when replica receives updates from master via Kafka
     */
    async processMasterUpdate(message: any): Promise<void> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'replica') {
        throw new Error('processMasterUpdate only available in replica mode');
      }

      const { messageId, contentType, contentId: masterDocumentId, data, operation } = message;

      // Handle conflict-rejected notifications from master (conflict detected)
      if (operation === 'conflict-rejected') {
        await this.handleConflictNotification(message);
        return;
      }

      // Handle conflict resolution notifications from master (admin resolved conflict)
      if (operation === 'conflict-resolved') {
        await this.handleConflictResolution(message);
        return;
      }

      // Handle create-ack from master (mapping confirmation)
      if (operation === 'create-ack') {
        await this.handleCreateAck(message);
        return;
      }

      if (!contentType || !masterDocumentId) {
        strapi.log.warn('[Sync] Invalid master update: missing required fields');
        return;
      }

      // Skip updates that originated from this ship to avoid loops
      const documentMapping = strapi.plugin('offline-sync').service('document-mapping');
      const shipId = config.shipId;

      // Set flag to prevent Document Service middleware from re-queueing these changes
      // This prevents infinite sync loops (master->replica->master->...)
      (strapi as any)._offlineSyncFromMaster = true;

      try {
        // Validate content type exists
        const model = strapi.contentTypes[contentType];
        if (!model) {
          strapi.log.warn(`[Sync] Unknown content type from master: ${contentType}`);
          return;
        }

        // Clean data - remove internal fields
        let cleanedData = this.cleanSyncData(data || {});

        // On-demand media sync: Download images BEFORE transforming URLs
        // This ensures images are available in MinIO when content is displayed
        const mediaSync = strapi.plugin('offline-sync').service('media-sync');
        if (mediaSync.isEnabled()) {
          // Sync media files referenced in this content (non-blocking but awaited)
          try {
            await mediaSync.syncContentMedia(data);
          } catch (mediaSyncError: any) {
            // Non-critical: log but continue with content sync
            strapi.log.debug(`[Sync] Media sync skipped: ${mediaSyncError.message}`);
          }

          // Transform media URLs from master (OSS) to replica (MinIO)
          cleanedData = mediaSync.transformToReplica(cleanedData);
        }

        // Check if we have a local copy of this master document
        // (reverse lookup: find local doc mapped to this master doc)
        const localMapping = await documentMapping.findByMasterDocumentId(
          shipId,
          contentType,
          masterDocumentId
        );

        if (operation === 'delete') {
          const deleteLocale = message.locale || null;
          strapi.log.info(`[Sync] 🗑️ Processing delete for ${contentType}/${masterDocumentId}${deleteLocale ? ` [${deleteLocale}]` : ' [all locales]'}`);
          strapi.log.info(`[Sync]   Looking up mapping for shipId=${shipId}, masterDoc=${masterDocumentId}`);

          if (localMapping?.replicaDocumentId) {
            strapi.log.info(`[Sync]   Found mapping: masterDoc=${masterDocumentId} → localDoc=${localMapping.replicaDocumentId}`);

            // Check if local document exists
            const findOptions: any = { documentId: localMapping.replicaDocumentId };
            if (deleteLocale) {
              findOptions.locale = deleteLocale;
            }

            const localDoc = await strapi.documents(contentType).findOne(findOptions);

            if (localDoc) {
              // Use locale if provided (for locale-specific deletes)
              const deleteOptions: any = { documentId: localMapping.replicaDocumentId };
              if (deleteLocale) {
                deleteOptions.locale = deleteLocale;
              }

              await strapi.documents(contentType).delete(deleteOptions);
              strapi.log.info(`[Sync] ✅ Deleted local ${contentType}${deleteLocale ? ` [${deleteLocale}]` : ''} (${localMapping.replicaDocumentId}) from master`);
            } else {
              strapi.log.warn(`[Sync] ⚠️ Local document not found: ${localMapping.replicaDocumentId}${deleteLocale ? ` [${deleteLocale}]` : ''}`);
            }

            // Only clean up mapping if ALL locales were deleted (no specific locale)
            if (!deleteLocale) {
              await documentMapping.deleteMapping(shipId, contentType, localMapping.replicaDocumentId);
              strapi.log.info(`[Sync]   Mapping removed (all locales deleted)`);
            } else {
              strapi.log.info(`[Sync]   Mapping preserved (only locale ${deleteLocale} deleted)`);
            }
          } else {
            strapi.log.warn(`[Sync] ⚠️ No mapping found for ${contentType}/${masterDocumentId}`);
            strapi.log.warn(`[Sync]   Content may have been created before sync was active`);
            strapi.log.warn(`[Sync]   Or this shipId (${shipId}) doesn't match the original sync`);
          }
        } else if (localMapping?.replicaDocumentId) {
          // Update existing local document
          const localDoc = await strapi.documents(contentType).findOne({
            documentId: localMapping.replicaDocumentId
          });

          if (localDoc) {
            // Check for local modifications (conflict detection)
            const localUpdatedAt = localDoc.updatedAt ? new Date(localDoc.updatedAt) : null;
            const mappingUpdatedAt = localMapping.updatedAt ? new Date(localMapping.updatedAt) : null;

            // If local was modified since last sync, we have a conflict
            const hasLocalChanges = mappingUpdatedAt && localUpdatedAt && localUpdatedAt > mappingUpdatedAt;

            if (hasLocalChanges) {
              // Log conflict - local ship has unsaved changes that conflict with master update
              strapi.log.warn(`[Sync] ⚠️ Local conflict: ${contentType} (${localMapping.replicaDocumentId}) - local changes would be overwritten`);
              // For now, master wins (can be made configurable)
            }

            // Apply master update to local and publish
            const updateOptions: any = {
              documentId: localMapping.replicaDocumentId,
              data: cleanedData,
              status: 'published',
            };

            // Include locale if specified (for locale-specific updates)
            if (message.locale) {
              updateOptions.locale = message.locale;
            }

            await strapi.documents(contentType).update(updateOptions);

            // Update mapping timestamp - master made this change
            await documentMapping.setMapping(shipId, contentType, localMapping.replicaDocumentId, masterDocumentId, 'master');

            strapi.log.info(`[Sync] 📥 Updated local ${contentType}${message.locale ? ` [${message.locale}]` : ''} (${localMapping.replicaDocumentId}) from master`);
          } else {
            // Local doc was deleted, recreate it
            const recreateOptions: any = {
              data: cleanedData,
              status: 'published',
            };

            // Include locale if specified
            if (message.locale) {
              recreateOptions.locale = message.locale;
            }

            const created = await strapi.documents(contentType).create(recreateOptions);

            if (created?.documentId) {
              // Master triggered this recreate
              await documentMapping.setMapping(shipId, contentType, created.documentId, masterDocumentId, 'master');
              strapi.log.info(`[Sync] 📥 Recreated ${contentType}${message.locale ? ` [${message.locale}]` : ''}: master ${masterDocumentId} -> local ${created.documentId}`);

              // Send mapping ACK to master so it knows the relationship
              const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
              if (kafkaProducer.isConnected()) {
                await kafkaProducer.sendMappingAck({
                  contentType,
                  replicaDocumentId: created.documentId,
                  masterDocumentId,
                });
              }
            }
          }
        } else if (operation !== 'delete') {
          // No local copy exists - create new document (but NOT for delete operations)
          const createOptions: any = {
            data: cleanedData,
            status: 'published',
          };

          // Include locale if specified
          if (message.locale) {
            createOptions.locale = message.locale;
          }

          const created = await strapi.documents(contentType).create(createOptions);

          if (created?.documentId) {
            // Master created this document
            await documentMapping.setMapping(shipId, contentType, created.documentId, masterDocumentId, 'master');
            strapi.log.info(`[Sync] 📥 Created local ${contentType} from master: ${masterDocumentId} -> ${created.documentId}`);

            // Send mapping ACK to master so it knows the relationship
            const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
            if (kafkaProducer.isConnected()) {
              await kafkaProducer.sendMappingAck({
                contentType,
                replicaDocumentId: created.documentId,
                masterDocumentId,
              });
            }
          }
        } else {
          // Delete operation but no local mapping - nothing to delete, just log
          strapi.log.debug(`[Sync] Delete skipped - no local copy of ${contentType}/${masterDocumentId}`);
        }

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        strapi.log.error(`[Sync] Failed to process master update: ${contentType}:${masterDocumentId} - ${errorMessage}`);
      } finally {
        // Always reset the flag to allow normal local changes to be queued
        (strapi as any)._offlineSyncFromMaster = false;
      }
    },

    /**
     * Handle conflict notification from master (replica side)
     * Called when master rejects our update due to conflict
     */
    async handleConflictNotification(message: any): Promise<void> {
      const config = strapi.config.get('plugin::offline-sync', {});
      const {
        shipId,
        contentType,
        contentId,
        replicaDocumentId,
        conflictId,
        reason,
        masterData,
        shipData,
        queueId,
      } = message;

      // Only process if this notification is for our ship
      if (shipId !== config.shipId) {
        strapi.log.debug(`[Sync] Ignoring conflict notification for different ship: ${shipId}`);
        return;
      }

      strapi.log.warn(`[Sync] ⚠️ CONFLICT NOTIFICATION received from master`);
      strapi.log.warn(`[Sync]   Content: ${contentType} / ${replicaDocumentId}`);
      strapi.log.warn(`[Sync]   Conflict ID: ${conflictId}`);
      strapi.log.warn(`[Sync]   Reason: ${reason}`);

      try {
        // Mark the local sync_queue entry as 'conflict'
        const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
        await syncQueue.markConflict({
          contentType,
          contentId: replicaDocumentId,
          shipId: config.shipId,
          conflictId,
          reason,
        });

        // Emit an event for the admin UI to show notification (optional)
        strapi.eventHub?.emit('offline-sync.conflict', {
          shipId: config.shipId,
          contentType,
          contentId: replicaDocumentId,
          conflictId,
          reason,
          masterData,
          shipData,
          timestamp: new Date().toISOString(),
        });

        strapi.log.info(`[Sync] Conflict marked locally as PENDING. Awaiting resolution from master admin.`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        strapi.log.error(`[Sync] Failed to handle conflict notification: ${errorMessage}`);
      }
    },

    /**
     * Handle conflict resolution notification from master (replica side)
     * Called when master admin resolves a conflict
     */
    async handleConflictResolution(message: any): Promise<void> {
      const config = strapi.config.get('plugin::offline-sync', {});
      const {
        shipId,
        contentType,
        contentId,
        replicaDocumentId,
        conflictId,
        resolution, // 'keep-ship', 'keep-master', 'merge'
        resolvedData,
        resolvedBy,
      } = message;

      // Only process if this notification is for our ship
      if (shipId !== config.shipId) {
        strapi.log.debug(`[Sync] Ignoring conflict resolution for different ship: ${shipId}`);
        return;
      }

      strapi.log.info(`[Sync] ✅ CONFLICT RESOLUTION received from master`);
      strapi.log.info(`[Sync]   Content: ${contentType} / ${replicaDocumentId}`);
      strapi.log.info(`[Sync]   Conflict ID: ${conflictId}`);
      strapi.log.info(`[Sync]   Resolution: ${resolution}`);
      strapi.log.info(`[Sync]   Resolved by: ${resolvedBy || 'admin'}`);

      const syncQueue = strapi.plugin('offline-sync').service('sync-queue');

      try {
        switch (resolution) {
          case 'keep-ship':
            // Ship's version was accepted - our changes were applied to master
            await syncQueue.markConflictAccepted({
              contentType,
              contentId: replicaDocumentId,
              shipId: config.shipId,
              conflictId,
            });
            strapi.log.info(`[Sync] 🎉 Your changes were ACCEPTED and applied to master!`);
            break;

          case 'keep-master':
            // Master's version was kept - our changes were rejected
            await syncQueue.markConflictRejected({
              contentType,
              contentId: replicaDocumentId,
              shipId: config.shipId,
              conflictId,
              reason: 'Admin chose to keep master version',
            });

            // Optionally apply master's resolved data to local
            if (resolvedData) {
              try {
                const documentMapping = strapi.plugin('offline-sync').service('document-mapping');
                const localMapping = await documentMapping.findByMasterDocumentId(
                  config.shipId,
                  contentType,
                  contentId
                );

                if (localMapping?.replicaDocumentId) {
                  (strapi as any)._offlineSyncFromMaster = true;
                  await strapi.documents(contentType).update({
                    documentId: localMapping.replicaDocumentId,
                    data: this.cleanSyncData(resolvedData),
                    status: 'published',
                  });
                  (strapi as any)._offlineSyncFromMaster = false;
                  strapi.log.info(`[Sync] Local content updated with master's version`);
                }
              } catch (updateError: any) {
                strapi.log.debug(`[Sync] Could not update local content: ${updateError.message}`);
              }
            }
            strapi.log.warn(`[Sync] ❌ Your changes were REJECTED. Master version was kept.`);
            break;

          case 'merge':
            // Changes were merged
            await syncQueue.markConflictMerged({
              contentType,
              contentId: replicaDocumentId,
              shipId: config.shipId,
              conflictId,
              mergeDetails: 'Changes were merged by admin',
            });

            // Apply merged data to local
            if (resolvedData) {
              try {
                const documentMapping = strapi.plugin('offline-sync').service('document-mapping');
                const localMapping = await documentMapping.findByMasterDocumentId(
                  config.shipId,
                  contentType,
                  contentId
                );

                if (localMapping?.replicaDocumentId) {
                  (strapi as any)._offlineSyncFromMaster = true;
                  await strapi.documents(contentType).update({
                    documentId: localMapping.replicaDocumentId,
                    data: this.cleanSyncData(resolvedData),
                    status: 'published',
                  });
                  (strapi as any)._offlineSyncFromMaster = false;
                  strapi.log.info(`[Sync] Local content updated with merged version`);
                }
              } catch (updateError: any) {
                strapi.log.debug(`[Sync] Could not update local content: ${updateError.message}`);
              }
            }
            strapi.log.info(`[Sync] 🔀 Changes were MERGED by admin.`);
            break;

          default:
            strapi.log.warn(`[Sync] Unknown resolution type: ${resolution}`);
        }

        // Emit an event for the admin UI
        strapi.eventHub?.emit('offline-sync.conflict-resolved', {
          shipId: config.shipId,
          contentType,
          contentId: replicaDocumentId,
          conflictId,
          resolution,
          timestamp: new Date().toISOString(),
        });

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        strapi.log.error(`[Sync] Failed to handle conflict resolution: ${errorMessage}`);
      }
    },

    /**
     * Handle mapping acknowledgment from replica (master side)
     * Called when replica creates a local copy of a master document and sends ACK
     * This allows master to save the mapping so future updates from replica work correctly
     */
    async handleMappingAck(message: any): Promise<void> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'master') {
        strapi.log.debug('[Sync] handleMappingAck called in non-master mode, skipping');
        return;
      }

      const { shipId, contentType, replicaDocumentId, masterDocumentId } = message;

      if (!shipId || !contentType || !replicaDocumentId || !masterDocumentId) {
        strapi.log.warn('[Sync] Invalid mapping ACK: missing required fields');
        return;
      }

      try {
        const documentMapping = strapi.plugin('offline-sync').service('document-mapping');

        // Check if mapping already exists
        const existingMapping = await documentMapping.getMasterDocumentId(
          shipId,
          contentType,
          replicaDocumentId
        );

        if (existingMapping) {
          strapi.log.debug(`[Sync] Mapping already exists for ${shipId}/${contentType}/${replicaDocumentId}`);
          return;
        }

        // Verify the master document exists
        const masterDoc = await strapi.documents(contentType).findOne({
          documentId: masterDocumentId
        });

        if (!masterDoc) {
          strapi.log.warn(`[Sync] Master document not found: ${contentType}/${masterDocumentId}`);
          return;
        }

        // Save the mapping on master - ship made this change
        await documentMapping.setMapping(shipId, contentType, replicaDocumentId, masterDocumentId, shipId);

        strapi.log.info(`[Sync] ✅ Mapping ACK received: ${shipId}'s ${replicaDocumentId} → master's ${masterDocumentId}`);

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        strapi.log.error(`[Sync] Failed to handle mapping ACK: ${errorMessage}`);
      }
    },

    /**
     * Handle create acknowledgment from master (replica side)
     * Called when master creates a document from our CREATE operation
     * This tells us: "Your replicaDocId R001 is now masterDocId M001"
     * We save this mapping so Master's future updates work correctly
     */
    async handleCreateAck(message: any): Promise<void> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'replica') {
        strapi.log.debug('[Sync] handleCreateAck called in non-replica mode, skipping');
        return;
      }

      const { shipId, contentType, replicaDocumentId, masterDocumentId, locale } = message;

      // Only process if this ACK is for our ship
      if (shipId !== config.shipId) {
        strapi.log.debug(`[Sync] Ignoring create ACK for different ship: ${shipId}`);
        return;
      }

      if (!contentType || !replicaDocumentId || !masterDocumentId) {
        strapi.log.warn('[Sync] Invalid create ACK: missing required fields');
        return;
      }

      try {
        const documentMapping = strapi.plugin('offline-sync').service('document-mapping');

        // Check if mapping already exists
        const existingMapping = await documentMapping.getMapping(
          config.shipId,
          contentType,
          replicaDocumentId
        );

        if (existingMapping) {
          strapi.log.debug(`[Sync] Mapping already exists for ${contentType}/${replicaDocumentId}`);
          return;
        }

        // Verify the local document exists (include locale for i18n support)
        const findOptions: any = { documentId: replicaDocumentId };
        if (locale) {
          findOptions.locale = locale;
        }
        const localDoc = await strapi.documents(contentType).findOne(findOptions);

        if (!localDoc) {
          strapi.log.warn(`[Sync] Local document not found: ${contentType}/${replicaDocumentId}${locale ? ` [${locale}]` : ''}`);
          return;
        }

        // Save the mapping on replica - this ship created it
        // This allows us to find master's document when Master sends updates
        await documentMapping.setMapping(config.shipId, contentType, replicaDocumentId, masterDocumentId, config.shipId);

        strapi.log.info(`[Sync] ✅ Create ACK received: my ${replicaDocumentId} → master's ${masterDocumentId}${locale ? ` [${locale}]` : ''}`);

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        strapi.log.error(`[Sync] Failed to handle create ACK: ${errorMessage}`);
      }
    },
  };
};

