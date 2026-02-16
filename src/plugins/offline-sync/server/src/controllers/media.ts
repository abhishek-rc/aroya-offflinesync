/**
 * Media Sync Controller
 * Provides endpoints for media sync status and statistics
 */

export default ({ strapi }: { strapi: any }) => ({
  /**
   * GET /api/offline-sync/media/stats
   * Returns file counts and sync status for OSS and MinIO
   */
  async stats(ctx: any) {
    try {
      const mediaSync = strapi.plugin('offline-sync').service('media-sync');

      if (!mediaSync.isEnabled()) {
        return ctx.send({
          enabled: false,
          message: 'Media sync is not enabled',
        });
      }

      // Get counts from both OSS and MinIO
      const [ossCount, minioCount, health, syncStats] = await Promise.all([
        mediaSync.getOssFileCount(),
        mediaSync.getMinioFileCount(),
        mediaSync.getHealth(),
        Promise.resolve(mediaSync.getStats()),
      ]);

      const isSynced = ossCount.count === minioCount.count;
      const missingFiles = ossCount.count - minioCount.count;

      return ctx.send({
        enabled: true,
        oss: {
          connected: health.ossConnected,
          count: ossCount.count,
          error: ossCount.error || null,
        },
        minio: {
          connected: health.minioConnected,
          count: minioCount.count,
          error: minioCount.error || null,
        },
        sync: {
          isSynced,
          missingFiles: missingFiles > 0 ? missingFiles : 0,
          lastSyncAt: syncStats.lastSyncAt,
          isRunning: syncStats.isRunning,
          lastError: syncStats.error,
        },
        stats: {
          filesDownloaded: syncStats.filesDownloaded,
          filesSkipped: syncStats.filesSkipped,
          filesFailed: syncStats.filesFailed,
          totalBytes: syncStats.totalBytes,
        },
      });
    } catch (error: any) {
      ctx.status = 500;
      return ctx.send({
        error: 'Failed to get media stats',
        message: error.message,
      });
    }
  },

  /**
   * POST /api/offline-sync/media/sync
   * Trigger manual sync from OSS to MinIO
   */
  async triggerSync(ctx: any) {
    try {
      const mediaSync = strapi.plugin('offline-sync').service('media-sync');

      if (!mediaSync.isEnabled()) {
        ctx.status = 400;
        return ctx.send({
          error: 'Media sync is not enabled',
        });
      }

      // Start sync in background
      const syncPromise = mediaSync.sync();

      // Return immediately with status
      return ctx.send({
        message: 'Sync started',
        status: 'running',
      });
    } catch (error: any) {
      ctx.status = 500;
      return ctx.send({
        error: 'Failed to start sync',
        message: error.message,
      });
    }
  },

  /**
   * GET /api/offline-sync/media/health
   * Quick health check for media sync services
   */
  async health(ctx: any) {
    try {
      const mediaSync = strapi.plugin('offline-sync').service('media-sync');

      if (!mediaSync.isEnabled()) {
        return ctx.send({
          enabled: false,
          status: 'disabled',
        });
      }

      const health = await mediaSync.getHealth();

      return ctx.send({
        enabled: true,
        status: health.minioConnected && health.ossConnected ? 'healthy' : 'degraded',
        oss: health.ossConnected ? 'connected' : 'disconnected',
        minio: health.minioConnected ? 'connected' : 'disconnected',
        lastSync: health.lastSync,
        isRunning: health.isRunning,
      });
    } catch (error: any) {
      ctx.status = 500;
      return ctx.send({
        enabled: true,
        status: 'error',
        error: error.message,
      });
    }
  },
});
