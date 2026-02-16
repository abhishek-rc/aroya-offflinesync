export default ({ strapi }: { strapi: any }) => {
  let tableExists: boolean | null = null;

  const parseJsonField = (value: any): any => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  };

  return {
    /**
     * Check if conflict_logs table exists (cached)
     */
    async ensureTable(): Promise<boolean> {
      if (tableExists !== null) return tableExists;

      const db = strapi.db.connection;
      tableExists = await db.schema.hasTable('conflict_logs');
      return tableExists ?? false;
    },

    /**
     * Log a conflict (only if no unresolved conflict exists for this document)
     */
    async logConflict(conflict: {
      contentType: string;
      contentId: string | number;
      shipId: string;
      shipVersion: number;
      masterVersion: number;
      shipData: any;
      masterData: any;
      conflictType: string;
    }): Promise<any> {
      if (!await this.ensureTable()) {
        strapi.log.warn('conflict_logs table does not exist');
        return null;
      }

      const db = strapi.db.connection;

      // Check if there's already an unresolved conflict for this document
      const existingConflict = await db('conflict_logs')
        .where({
          content_type: conflict.contentType,
          content_id: String(conflict.contentId),
          ship_id: conflict.shipId,
        })
        .whereNull('resolved_at')
        .first();

      if (existingConflict) {
        // Update the existing conflict with latest ship data instead of creating new one
        await db('conflict_logs')
          .where({ id: existingConflict.id })
          .update({
            ship_version: conflict.shipVersion,
            ship_data: JSON.stringify(conflict.shipData),
            master_data: JSON.stringify(conflict.masterData),
          });
        strapi.log.debug(`[Conflict] Updated existing conflict #${existingConflict.id}`);
        return existingConflict;
      }

      // Create new conflict
      const [result] = await db('conflict_logs')
        .insert({
          content_type: conflict.contentType,
          content_id: String(conflict.contentId),
          ship_id: conflict.shipId,
          ship_version: conflict.shipVersion,
          master_version: conflict.masterVersion,
          ship_data: JSON.stringify(conflict.shipData),
          master_data: JSON.stringify(conflict.masterData),
          conflict_type: conflict.conflictType,
          created_at: new Date(),
        })
        .returning('*');

      return result;
    },

    /**
     * List all conflicts
     */
    async listConflicts(): Promise<any[]> {
      if (!await this.ensureTable()) {
        return [];
      }

      const db = strapi.db.connection;
      const conflicts = await db('conflict_logs')
        .whereNull('resolved_at')
        .orderBy('created_at', 'desc');

      return conflicts.map((conflict: any) => ({
        ...conflict,
        ship_data: parseJsonField(conflict.ship_data),
        master_data: parseJsonField(conflict.master_data),
      }));
    },

    /**
     * Get a specific conflict
     */
    async getConflict(id: number): Promise<any> {
      if (!await this.ensureTable()) {
        return null;
      }

      const db = strapi.db.connection;
      const conflict = await db('conflict_logs').where({ id }).first();

      if (!conflict) {
        return null;
      }

      return {
        ...conflict,
        ship_data: parseJsonField(conflict.ship_data),
        master_data: parseJsonField(conflict.master_data),
      };
    },

    /**
     * Resolve a conflict - applies the chosen strategy and updates mapping timestamp
     */
    async resolveConflict(
      id: number,
      strategy: 'keep-ship' | 'keep-master' | 'merge',
      mergeData?: any
    ): Promise<any> {
      if (!await this.ensureTable()) {
        throw new Error('conflict_logs table does not exist');
      }

      const db = strapi.db.connection;
      const conflict = await db('conflict_logs').where({ id }).first();

      if (!conflict) {
        throw new Error('Conflict not found');
      }

      if (conflict.resolved_at) {
        throw new Error('Conflict already resolved');
      }

      const contentType = conflict.content_type;
      const documentId = conflict.content_id;
      const shipId = conflict.ship_id;
      const shipData = parseJsonField(conflict.ship_data);

      try {
        const documentMapping = strapi.plugin('offline-sync').service('document-mapping');

        if (strategy === 'keep-ship') {
          // Apply ship data to master and publish
          await strapi.documents(contentType).update({
            documentId,
            data: shipData,
            status: 'published',
          });
          strapi.log.info(`[Conflict] ✅ #${id} resolved: Applied ship data`);

        } else if (strategy === 'keep-master') {
          // Keep master data - no document update needed, but ensure it's published
          await strapi.documents(contentType).publish({ documentId });
          strapi.log.info(`[Conflict] ✅ #${id} resolved: Kept master data`);

        } else if (strategy === 'merge' && mergeData) {
          // Apply merged data and publish
          await strapi.documents(contentType).update({
            documentId,
            data: mergeData,
            status: 'published',
          });
          strapi.log.info(`[Conflict] ✅ #${id} resolved: Applied merged data`);
        }

        // IMPORTANT: Update the mapping timestamp so future syncs don't see a conflict
        // Find the mapping by masterDocumentId and update it
        const mappingContentType = 'plugin::offline-sync.document-mapping';
        const existingMapping = await strapi.documents(mappingContentType).findFirst({
          filters: {
            shipId: { $eq: shipId },
            contentType: { $eq: contentType },
            masterDocumentId: { $eq: documentId },
          },
        });

        if (existingMapping) {
          // Touch the mapping to update its timestamp
          await strapi.documents(mappingContentType).update({
            documentId: existingMapping.documentId,
            data: { masterDocumentId: documentId }, // Same value, just to trigger updatedAt
          });
          strapi.log.debug(`[Conflict] Updated mapping timestamp for ${contentType}/${documentId}`);
        }

        // Mark conflict as resolved
        await db('conflict_logs').where({ id }).update({
          resolution_strategy: strategy,
          resolution_data: mergeData ? JSON.stringify(mergeData) : null,
          resolved_at: new Date(),
          resolved_by: 'admin',
        });

        // Get the resolved document data to send to ship
        let resolvedData = null;
        try {
          const doc = await strapi.documents(contentType).findOne({ documentId });
          if (doc) {
            // Clean the data before sending
            const syncService = strapi.plugin('offline-sync').service('sync-service');
            resolvedData = syncService.cleanSyncData(doc);
          }
        } catch (e) {
          // Non-critical, continue without resolved data
        }

        // Send resolution notification to ship via Kafka
        try {
          const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
          if (kafkaProducer.isConnected()) {
            await kafkaProducer.sendToShips({
              messageId: `conflict-resolved-${id}-${Date.now()}`,
              shipId: shipId,
              timestamp: new Date().toISOString(),
              operation: 'conflict-resolved',
              contentType,
              contentId: documentId,
              replicaDocumentId: existingMapping?.replicaDocumentId || null,
              conflictId: id,
              resolution: strategy,
              resolvedData: resolvedData,
              resolvedBy: 'admin',
            });
            strapi.log.info(`[Conflict] 📤 Sent resolution notification to ship ${shipId}`);
          }
        } catch (kafkaError: any) {
          // Non-critical, log but don't fail
          strapi.log.warn(`[Conflict] Could not notify ship of resolution: ${kafkaError.message}`);
        }

        return { success: true, conflictId: id, strategy, contentType, documentId, shipId };

      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        strapi.log.error(`[Conflict] Failed to resolve #${id}: ${msg}`);
        throw new Error(`Resolution failed: ${msg}`);
      }
    },
  };
};

