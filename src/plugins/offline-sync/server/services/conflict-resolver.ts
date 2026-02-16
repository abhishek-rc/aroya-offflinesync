export default ({ strapi }: { strapi: any }) => {
  // Define autoMerge first so it can be used by resolveConflict
  const autoMerge = async (local: any, remote: any): Promise<any> => {
    const merged = { ...local };

    // Merge fields from remote that don't conflict
    for (const key in remote) {
      if (
        !['id', 'createdAt', 'updatedAt', 'syncVersion'].includes(key) &&
        merged[key] === undefined
      ) {
        merged[key] = remote[key];
      }
    }

    return merged;
  };

  return {
    /**
     * Detect conflict between local and remote data
     */
    async detectConflict(
      local: any,
      remote: any,
      contentType: string,
      entityId: number
    ): Promise<{
      hasConflict: boolean;
      conflictingFields?: string[];
      conflictType?: 'direct' | 'indirect' | 'structural';
    }> {
      const versionTracker = strapi.plugin('offline-sync').service('version-tracker');
      return await versionTracker.detectConflict(local, remote);
    },

    /**
     * Create conflict log entry
     */
    async flagConflict(
      contentType: string,
      entityId: number,
      localData: any,
      remoteData: any,
      conflictingFields: string[],
      conflictType: 'direct' | 'indirect' | 'structural' = 'direct'
    ): Promise<any> {
      const conflictLog = strapi.db.query('plugin::offline-sync.conflict-log');

      // Check if conflict already exists
      const existing = await conflictLog.findOne({
        where: {
          contentType,
          entityId,
          status: 'pending',
        },
      });

      if (existing) {
        // Update existing conflict
        return await conflictLog.update({
          where: { id: existing.id },
          data: {
            localData,
            remoteData,
            conflictingFields,
            conflictType,
          },
        });
      }

      // Create new conflict log
      return await conflictLog.create({
        data: {
          contentType,
          entityId,
          localData,
          remoteData,
          conflictingFields,
          conflictType,
          status: 'pending',
        },
      });
    },

    /**
     * Auto-merge non-conflicting changes
     */
    autoMerge,

    /**
     * Last write wins strategy
     */
    async lastWriteWins(local: any, remote: any): Promise<any> {
      const localUpdated = new Date(local.updatedAt || 0);
      const remoteUpdated = new Date(remote.updatedAt || 0);

      return remoteUpdated > localUpdated ? remote : local;
    },

    /**
     * Resolve conflict manually
     */
    async resolveConflict(
      conflictId: number,
      resolution: 'keep_local' | 'keep_remote' | 'merge',
      mergedData?: any,
      resolvedBy?: number
    ): Promise<void> {
      const conflictLog = strapi.db.query('plugin::offline-sync.conflict-log');
      const versionTracker = strapi.plugin('offline-sync').service('version-tracker');

      const conflict = await conflictLog.findOne({ where: { id: conflictId } });

      if (!conflict || conflict.status === 'resolved') {
        throw new Error('Conflict not found or already resolved');
      }

      const { contentType, entityId, localData, remoteData } = conflict;

      let finalData: any;

      switch (resolution) {
        case 'keep_local':
          finalData = localData;
          break;
        case 'keep_remote':
          finalData = remoteData;
          break;
        case 'merge':
          finalData = mergedData || (await autoMerge(localData, remoteData));
          break;
        default:
          throw new Error(`Invalid resolution: ${resolution}`);
      }

      // Check if entity exists
      const entity = await strapi.entityService.findOne(contentType, entityId);

      if (!entity) {
        // Entity was deleted, create it if resolution requires it
        if (resolution === 'keep_local' || resolution === 'merge') {
          await strapi.entityService.create(contentType, {
            data: finalData,
          });
        } else {
          // Entity doesn't exist and we're keeping remote (which also doesn't exist)
          // Just mark conflict as resolved
        }
      } else {
        // Update the entity
        await strapi.entityService.update(contentType, entityId, {
          data: finalData,
        });
      }

      // Mark conflict as resolved
      await conflictLog.update({
        where: { id: conflictId },
        data: {
          status: 'resolved',
          resolution,
          mergedData: finalData,
          resolvedAt: new Date(),
          resolvedBy,
        },
      });

      // Update sync metadata
      await versionTracker.markSynced(contentType, entityId);
    },

    /**
     * Get pending conflicts
     */
    async getPendingConflicts(): Promise<any[]> {
      const conflictLog = strapi.db.query('plugin::offline-sync.conflict-log');

      return await conflictLog.findMany({
        where: {
          status: 'pending',
        },
        orderBy: { createdAt: 'desc' },
      });
    },

    /**
     * Get conflict by ID
     */
    async getConflict(conflictId: number): Promise<any> {
      const conflictLog = strapi.db.query('plugin::offline-sync.conflict-log');

      return await conflictLog.findOne({ where: { id: conflictId } });
    },
  };
};

