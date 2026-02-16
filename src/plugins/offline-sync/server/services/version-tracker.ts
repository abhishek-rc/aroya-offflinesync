export default ({ strapi }: { strapi: any }) => ({
  /**
   * Increment version for an entity
   */
  async incrementVersion(
    contentType: string,
    id: number,
    location: string
  ): Promise<number> {
    const syncMetadata = strapi.db.query('plugin::offline-sync.sync-metadata');

    // Find or create sync metadata
    let metadata = await syncMetadata.findOne({
      where: {
        contentType,
        entityId: id,
      },
    });

    if (!metadata) {
      metadata = await syncMetadata.create({
        data: {
          contentType,
          entityId: id,
          syncVersion: 1,
          modifiedByLocation: location,
          syncStatus: 'pending',
        },
      });
      return 1;
    }

    // Increment version
    const newVersion = metadata.syncVersion + 1;

    await syncMetadata.update({
      where: { id: metadata.id },
      data: {
        syncVersion: newVersion,
        modifiedByLocation: location,
        syncStatus: 'pending',
      },
    });

    return newVersion;
  },

  /**
   * Get current version of an entity
   */
  async getVersion(contentType: string, id: number): Promise<number | null> {
    const syncMetadata = strapi.db.query('plugin::offline-sync.sync-metadata');

    const metadata = await syncMetadata.findOne({
      where: {
        contentType,
        entityId: id,
      },
    });

    return metadata?.syncVersion || null;
  },

  /**
   * Get sync metadata for an entity
   */
  async getMetadata(contentType: string, id: number) {
    const syncMetadata = strapi.db.query('plugin::offline-sync.sync-metadata');

    return await syncMetadata.findOne({
      where: {
        contentType,
        entityId: id,
      },
    });
  },

  /**
   * Detect conflict between local and remote entities
   */
  async detectConflict(local: any, remote: any): Promise<{
    hasConflict: boolean;
    conflictingFields?: string[];
    conflictType?: 'direct' | 'indirect' | 'structural';
  }> {
    if (!local || !remote) {
      return { hasConflict: false };
    }

    const localVersion = local.syncVersion || 0;
    const remoteVersion = remote.syncVersion || 0;

    // If versions are the same, no conflict
    if (localVersion === remoteVersion) {
      return { hasConflict: false };
    }

    // If one is ahead, check for field-level conflicts
    const conflictingFields: string[] = [];
    const localData = local.data || local;
    const remoteData = remote.data || remote;

    // Compare fields (excluding metadata fields)
    const excludeFields = [
      'id',
      'createdAt',
      'updatedAt',
      'publishedAt',
      'syncVersion',
      'lastSyncedAt',
      'modifiedByLocation',
      'syncStatus',
      'conflictFlag',
    ];

    const localKeys = Object.keys(localData).filter(
      (key) => !excludeFields.includes(key)
    );
    const remoteKeys = Object.keys(remoteData).filter(
      (key) => !excludeFields.includes(key)
    );

    // Check for conflicting field changes
    for (const key of localKeys) {
      if (remoteKeys.includes(key)) {
        const localValue = JSON.stringify(localData[key]);
        const remoteValue = JSON.stringify(remoteData[key]);

        if (localValue !== remoteValue) {
          conflictingFields.push(key);
        }
      }
    }

    // Check for fields only in one version
    const onlyInLocal = localKeys.filter((k) => !remoteKeys.includes(k));
    const onlyInRemote = remoteKeys.filter((k) => !localKeys.includes(k));

    if (onlyInLocal.length > 0 || onlyInRemote.length > 0) {
      conflictingFields.push(...onlyInLocal, ...onlyInRemote);
    }

    if (conflictingFields.length > 0) {
      return {
        hasConflict: true,
        conflictingFields,
        conflictType: 'direct',
      };
    }

    return { hasConflict: false };
  },

  /**
   * Update sync metadata after successful sync
   */
  async markSynced(contentType: string, entityId: number) {
    const syncMetadata = strapi.db.query('plugin::offline-sync.sync-metadata');

    const metadata = await syncMetadata.findOne({
      where: {
        contentType,
        entityId,
      },
    });

    if (metadata) {
      await syncMetadata.update({
        where: { id: metadata.id },
        data: {
          lastSyncedAt: new Date(),
          syncStatus: 'synced',
          conflictFlag: false,
        },
      });
    }
  },
});

