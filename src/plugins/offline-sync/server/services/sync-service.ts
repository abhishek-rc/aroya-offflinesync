import axios from 'axios';

export default ({ strapi }: { strapi: any }) => {
  // Define all methods first
  const getLastSyncTimestamp = async (): Promise<Date | null> => {
    const syncMetadata = strapi.db.query('plugin::offline-sync.sync-metadata');

    const latest = await syncMetadata.findOne({
      orderBy: { lastSyncedAt: 'desc' },
    });

    return latest?.lastSyncedAt || null;
  };

  const updateLastSyncTimestamp = async (timestamp: Date): Promise<void> => {
    // Store in sync_sessions table for better tracking
    const pluginConfig = strapi.plugin('offline-sync').config;
    if (pluginConfig.mode === 'replica' && pluginConfig.shipId) {
      const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');
      await shipTracker.updateShipSyncStatus(pluginConfig.shipId, 'success');
    }
  };

  const applyChange = async (
    change: any,
    source: 'local' | 'remote'
  ): Promise<boolean> => {
    const versionTracker = strapi
      .plugin('offline-sync')
      .service('version-tracker');
    const conflictResolver = strapi
      .plugin('offline-sync')
      .service('conflict-resolver');

    const { contentType, entityId, data, operation, version } = change;

    try {
      // Validate content type exists
      const contentTypeModel = strapi.contentType(contentType);
      if (!contentTypeModel) {
        strapi.log.warn(`Content type ${contentType} not found, skipping change`);
        return false;
      }

      // Get local entity
      const localEntity = await strapi.entityService.findOne(
        contentType,
        entityId
      );

      // Get local metadata
      const localMetadata = await versionTracker.getMetadata(
        contentType,
        entityId
      );

      // Check for conflicts
      if (localEntity && localMetadata && source === 'remote') {
        const conflict = await versionTracker.detectConflict(
          { ...localEntity, syncVersion: localMetadata.syncVersion },
          { ...data, syncVersion: version }
        );

        if (conflict.hasConflict) {
          // Flag conflict
          await conflictResolver.flagConflict(
            contentType,
            entityId,
            localEntity,
            data,
            conflict.conflictingFields || [],
            conflict.conflictType
          );

          // Update sync metadata
          const syncMetadata = strapi.db.query(
            'plugin::offline-sync.sync-metadata'
          );
          await syncMetadata.update({
            where: {
              contentType,
              entityId,
            },
            data: {
              syncStatus: 'conflict',
              conflictFlag: true,
            },
          });

          return true; // Conflict detected
        }
      }

      // Apply the change
      switch (operation) {
        case 'create':
          if (!localEntity) {
            const created = await strapi.entityService.create(contentType, { data });
            await versionTracker.incrementVersion(
              contentType,
              entityId || created.id,
              source === 'local' ? 'local' : 'remote'
            );
          }
          break;

        case 'update':
          if (localEntity) {
            await strapi.entityService.update(contentType, entityId, { data });
            await versionTracker.incrementVersion(
              contentType,
              entityId,
              source === 'local' ? 'local' : 'remote'
            );
          } else {
            strapi.log.warn(
              `Entity ${contentType}:${entityId} not found for update, skipping`
            );
          }
          break;

        case 'delete':
          if (localEntity) {
            await strapi.entityService.delete(contentType, entityId);
            // Clean up sync metadata
            const syncMetadata = strapi.db.query(
              'plugin::offline-sync.sync-metadata'
            );
            await syncMetadata.delete({
              where: {
                contentType,
                entityId,
              },
            });
          }
          break;
      }

      // Mark as synced
      await versionTracker.markSynced(contentType, entityId);

      return false; // No conflict
    } catch (error: any) {
      strapi.log.error(`Error applying change: ${error.message}`);
      throw error;
    }
  };

  const pushToMaster = async (): Promise<{
    success: boolean;
    processed: number;
    conflicts: number;
    errors?: string[];
  }> => {
    const pluginConfig = strapi.plugin('offline-sync').config;
    const queueManager = strapi.plugin('offline-sync').service('queue-manager');

    if (pluginConfig.mode !== 'replica' || !pluginConfig.masterUrl) {
      return {
        success: false,
        processed: 0,
        conflicts: 0,
        errors: ['Not in replica mode or master URL not configured'],
      };
    }

    const pendingOps = await queueManager.getPending();
    if (pendingOps.length === 0) {
      return { success: true, processed: 0, conflicts: 0 };
    }

    // Prepare changes for master
    const changes = pendingOps.map((op: any) => ({
      operation: op.operation,
      contentType: op.contentType,
      entityId: op.entityId,
      data: op.data,
      version: op.version,
      location: op.location || pluginConfig.shipId,
    }));

    try {
      // Send to master
      const response = await axios.post(
        `${pluginConfig.masterUrl}/api/sync/push`,
        {
          shipId: pluginConfig.shipId,
          changes,
        },
        {
          timeout: 30000,
        }
      );

      const { processed, conflicts, updatedEntities } = response.data;

      // Mark operations as synced
      for (const op of pendingOps) {
        if (processed > 0) {
          await queueManager.markSynced(op.id);
        }
      }

      // Update local entities with master's response
      if (updatedEntities) {
        for (const entity of updatedEntities) {
          await applyChange(entity, 'remote');
        }
      }

      return {
        success: true,
        processed: processed || 0,
        conflicts: conflicts || 0,
      };
    } catch (error: any) {
      // Mark operations as failed
      for (const op of pendingOps) {
        await queueManager.markFailed(
          op.id,
          error.message || 'Failed to push to master'
        );
      }

      return {
        success: false,
        processed: 0,
        conflicts: 0,
        errors: [error.message || 'Unknown error'],
      };
    }
  };

  const pullFromMaster = async (): Promise<{
    success: boolean;
    processed: number;
    conflicts: number;
    errors?: string[];
  }> => {
    const pluginConfig = strapi.plugin('offline-sync').config;
    const versionTracker = strapi
      .plugin('offline-sync')
      .service('version-tracker');
    const conflictResolver = strapi
      .plugin('offline-sync')
      .service('conflict-resolver');

    if (pluginConfig.mode !== 'replica' || !pluginConfig.masterUrl) {
      return {
        success: false,
        processed: 0,
        conflicts: 0,
        errors: ['Not in replica mode or master URL not configured'],
      };
    }

    // Get last sync timestamp
    const lastSync = await getLastSyncTimestamp();

    try {
      // Request changes from master
      const response = await axios.get(
        `${pluginConfig.masterUrl}/api/sync/pull`,
        {
          params: {
            shipId: pluginConfig.shipId,
            lastSyncTimestamp: lastSync,
          },
          timeout: 30000,
        }
      );

      const { changes } = response.data;
      if (!changes || changes.length === 0) {
        return { success: true, processed: 0, conflicts: 0 };
      }

      let processed = 0;
      let conflicts = 0;

      // Apply each change
      for (const change of changes) {
        try {
          const conflict = await applyChange(change, 'remote');
          if (conflict) {
            conflicts++;
          } else {
            processed++;
          }
        } catch (error: any) {
          strapi.log.error(`Error applying change: ${error.message}`);
          // Continue with next change
        }
      }

      // Update last sync timestamp
      await updateLastSyncTimestamp(new Date());

      return {
        success: true,
        processed,
        conflicts,
      };
    } catch (error: any) {
      return {
        success: false,
        processed: 0,
        conflicts: 0,
        errors: [error.message || 'Unknown error'],
      };
    }
  };

  const sync = async (): Promise<{
    success: boolean;
    pushed: number;
    pulled: number;
    conflicts: number;
    errors?: string[];
  }> => {
    const pluginConfig = strapi.plugin('offline-sync').config;

    if (pluginConfig.mode !== 'replica') {
      return {
        success: false,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: ['Sync only available in replica mode'],
      };
    }

    const results = {
      success: true,
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [] as string[],
    };

    try {
      // Step 1: Push local changes
      const pushResult = await pushToMaster();
      results.pushed = pushResult.processed || 0;
      results.conflicts += pushResult.conflicts || 0;
      if (pushResult.errors) {
        results.errors.push(...pushResult.errors);
      }

      // Step 2: Pull remote changes
      const pullResult = await pullFromMaster();
      results.pulled = pullResult.processed || 0;
      results.conflicts += pullResult.conflicts || 0;
      if (pullResult.errors) {
        results.errors.push(...pullResult.errors);
      }
    } catch (error: any) {
      results.success = false;
      results.errors.push(error.message || 'Unknown error during sync');
    }

    return results;
  };

  const isMasterOnline = async (): Promise<boolean> => {
    const pluginConfig = strapi.plugin('offline-sync').config;

    if (!pluginConfig.masterUrl) {
      return false;
    }

    try {
      await axios.get(`${pluginConfig.masterUrl}/api/sync/status`, {
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  };

  // Return all methods
  return {
    sync,
    pushToMaster,
    pullFromMaster,
    applyChange,
    getLastSyncTimestamp,
    updateLastSyncTimestamp,
    isMasterOnline,
  };
};

