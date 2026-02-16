export default ({ strapi }: { strapi: any }) => {
  const pluginConfig = strapi.plugin('offline-sync').config;
  const versionTracker = strapi.plugin('offline-sync').service('version-tracker');
  const queueManager = strapi.plugin('offline-sync').service('queue-manager');
  const syncService = strapi.plugin('offline-sync').service('sync-service');

  // Register lifecycle hooks for all content types
  const registerLifecycleHooks = () => {
    // Subscribe to all models using wildcard
    strapi.db.lifecycles.subscribe({
      models: ['*'], // All models

      async afterCreate(event: any) {
        const { model, result } = event;
        const contentType = model.uid;

        // Skip plugin content types
        if (contentType.startsWith('plugin::')) {
          return;
        }

        const location = pluginConfig.mode === 'replica' ? 'local' : 'master';

        try {
          // Initialize sync metadata
          await versionTracker.incrementVersion(
            contentType,
            result.id,
            location
          );

          // If in replica mode, enqueue the operation
          if (pluginConfig.mode === 'replica') {
            await queueManager.enqueue({
              operation: 'create',
              contentType,
              entityId: result.id,
              data: result,
              version: 1,
              location: pluginConfig.shipId || 'local',
            });
          }
        } catch (error: any) {
          strapi.log.error(
            `Error in afterCreate hook for ${contentType}: ${error.message}`
          );
        }
      },

      async afterUpdate(event: any) {
        const { model, result } = event;
        const contentType = model.uid;

        // Skip plugin content types
        if (contentType.startsWith('plugin::')) {
          return;
        }

        const location = pluginConfig.mode === 'replica' ? 'local' : 'master';

        try {
          // Increment version
          const newVersion = await versionTracker.incrementVersion(
            contentType,
            result.id,
            location
          );

          // If in replica mode, enqueue the operation
          if (pluginConfig.mode === 'replica') {
            await queueManager.enqueue({
              operation: 'update',
              contentType,
              entityId: result.id,
              data: result,
              version: newVersion,
              location: pluginConfig.shipId || 'local',
            });
          }
        } catch (error: any) {
          strapi.log.error(
            `Error in afterUpdate hook for ${contentType}: ${error.message}`
          );
        }
      },

      async afterDelete(event: any) {
        const { model, result } = event;
        const contentType = model.uid;

        // Skip plugin content types
        if (contentType.startsWith('plugin::')) {
          return;
        }

        try {
          // Clean up sync metadata
          const syncMetadata = strapi.db.query(
            'plugin::offline-sync.sync-metadata'
          );
          await syncMetadata.delete({
            where: {
              contentType,
              entityId: result.id,
            },
          });

          // If in replica mode, enqueue the operation
          if (pluginConfig.mode === 'replica') {
            await queueManager.enqueue({
              operation: 'delete',
              contentType,
              entityId: result.id,
              data: null,
              version: 0,
              location: pluginConfig.shipId || 'local',
            });
          }
        } catch (error: any) {
          strapi.log.error(
            `Error in afterDelete hook for ${contentType}: ${error.message}`
          );
        }
      },
    });
  };

  // Start connectivity monitoring (replica only)
  const startConnectivityMonitoring = () => {
    if (pluginConfig.mode === 'replica') {
      const connectivityTracker = strapi
        .plugin('offline-sync')
        .service('connectivity-tracker');
      const checkInterval = 30000; // Check every 30 seconds

      // Start monitoring
      connectivityTracker.startMonitoring(checkInterval);

      strapi.log.info(
        `Connectivity monitoring started (check interval: ${checkInterval}ms)`
      );
    }
  };

  // Start sync scheduler if in replica mode and autoSync is enabled
  const startSyncScheduler = () => {
    if (pluginConfig.mode === 'replica' && pluginConfig.autoSync) {
      const syncInterval = pluginConfig.syncInterval || 60000; // Default 1 minute
      const connectivityTracker = strapi
        .plugin('offline-sync')
        .service('connectivity-tracker');

      setInterval(async () => {
        try {
          // Check connectivity first (uses cached state)
          const isOnline = connectivityTracker.isConnected();

          if (isOnline) {
            strapi.log.info('Network connected - Starting scheduled sync...');
            const result = await syncService.sync();
            strapi.log.info(
              `Sync completed: ${result.pushed} pushed, ${result.pulled} pulled, ${result.conflicts} conflicts`
            );
          } else {
            // Double-check connectivity (force check)
            const connectivityCheck = await connectivityTracker.checkConnectivity();
            if (connectivityCheck.isOnline) {
              strapi.log.info('Network reconnected - Starting sync...');
              const result = await syncService.sync();
              strapi.log.info(
                `Sync completed: ${result.pushed} pushed, ${result.pulled} pulled, ${result.conflicts} conflicts`
              );
            } else {
              strapi.log.debug(
                `Network offline - Skipping sync. ${connectivityCheck.error || 'Master unreachable'}`
              );
            }
          }
        } catch (error: any) {
          strapi.log.error(`Error in sync scheduler: ${error.message}`);
        }
      }, syncInterval);

      strapi.log.info(
        `Sync scheduler started with interval: ${syncInterval}ms`
      );
    }
  };

  // Start ship tracker cleanup (master only)
  const startShipTrackerCleanup = () => {
    if (pluginConfig.mode === 'master') {
      const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');

      // Cleanup offline ships every 5 minutes
      setInterval(async () => {
        try {
          await shipTracker.markOfflineShips();
        } catch (error: any) {
          strapi.log.error(`Error in ship tracker cleanup: ${error.message}`);
        }
      }, 300000); // 5 minutes

      strapi.log.info('Ship tracker cleanup started');
    }
  };

  // Initialize on server start
  registerLifecycleHooks();
  startConnectivityMonitoring(); // Start connectivity monitoring first
  startSyncScheduler();
  startShipTrackerCleanup();

  strapi.log.info('Offline Sync plugin initialized');
};

