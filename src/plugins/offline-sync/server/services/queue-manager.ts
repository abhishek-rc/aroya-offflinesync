export default ({ strapi }: { strapi: any }) => ({
  /**
   * Enqueue an operation for sync
   */
  async enqueue(operation: {
    operation: 'create' | 'update' | 'delete';
    contentType: string;
    entityId: number;
    data?: any;
    version: number;
    location: string;
  }): Promise<any> {
    const pluginConfig = strapi.plugin('offline-sync').config;

    // Only enqueue if in replica mode
    if (pluginConfig.mode !== 'replica') {
      return null;
    }

    const syncQueue = strapi.db.query('plugin::offline-sync.sync-queue');

    // Check if operation already exists in queue
    const existing = await syncQueue.findOne({
      where: {
        contentType: operation.contentType,
        entityId: operation.entityId,
        status: 'pending',
      },
    });

    if (existing) {
      // Update existing queue item
      return await syncQueue.update({
        where: { id: existing.id },
        data: {
          operation: operation.operation,
          data: operation.data,
          version: operation.version,
          location: operation.location,
          retryCount: 0,
        },
      });
    }

    // Create new queue item
    return await syncQueue.create({
      data: {
        operation: operation.operation,
        contentType: operation.contentType,
        entityId: operation.entityId,
        data: operation.data,
        version: operation.version,
        status: 'pending',
        location: operation.location,
        retryCount: 0,
      },
    });
  },

  /**
   * Get pending operations
   */
  async getPending(limit?: number): Promise<any[]> {
    const syncQueue = strapi.db.query('plugin::offline-sync.sync-queue');
    const pluginConfig = strapi.plugin('offline-sync').config;

    const query: any = {
      where: {
        status: 'pending',
      },
      orderBy: { createdAt: 'asc' },
    };

    if (limit) {
      query.limit = limit;
    } else {
      query.limit = pluginConfig.batchSize || 50;
    }

    return await syncQueue.findMany(query);
  },

  /**
   * Mark operation as synced
   */
  async markSynced(operationId: number): Promise<void> {
    const syncQueue = strapi.db.query('plugin::offline-sync.sync-queue');

    await syncQueue.update({
      where: { id: operationId },
      data: {
        status: 'synced',
        syncedAt: new Date(),
      },
    });
  },

  /**
   * Mark operation as failed
   */
  async markFailed(operationId: number, errorMessage: string): Promise<void> {
    const syncQueue = strapi.db.query('plugin::offline-sync.sync-queue');

    const operation = await syncQueue.findOne({ where: { id: operationId } });
    const pluginConfig = strapi.plugin('offline-sync').config;

    if (operation) {
      const retryCount = (operation.retryCount || 0) + 1;
      const maxRetries = pluginConfig.retryAttempts || 3;

      await syncQueue.update({
        where: { id: operationId },
        data: {
          status: retryCount >= maxRetries ? 'failed' : 'pending',
          errorMessage,
          retryCount,
        },
      });
    }
  },

  /**
   * Get queue size
   */
  async getQueueSize(): Promise<number> {
    const syncQueue = strapi.db.query('plugin::offline-sync.sync-queue');

    const count = await syncQueue.count({
      where: {
        status: 'pending',
      },
    });

    return count;
  },

  /**
   * Retry failed operations
   */
  async retryFailed(): Promise<void> {
    const syncQueue = strapi.db.query('plugin::offline-sync.sync-queue');
    const pluginConfig = strapi.plugin('offline-sync').config;

    const failed = await syncQueue.findMany({
      where: {
        status: 'failed',
        retryCount: { $lt: pluginConfig.retryAttempts || 3 },
      },
    });

    for (const operation of failed) {
      await syncQueue.update({
        where: { id: operation.id },
        data: {
          status: 'pending',
          errorMessage: null,
        },
      });
    }
  },

  /**
   * Clear synced operations older than specified days
   */
  async clearSynced(daysOld: number = 7): Promise<void> {
    const syncQueue = strapi.db.query('plugin::offline-sync.sync-queue');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    await syncQueue.delete({
      where: {
        status: 'synced',
        syncedAt: { $lt: cutoffDate },
      },
    });
  },
});

