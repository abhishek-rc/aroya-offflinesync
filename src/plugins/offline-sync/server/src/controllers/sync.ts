// Strapi is available globally in controllers
declare const strapi: any;

export default {
  async getStatus(ctx: any) {
    try {
      const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
      const connectivityMonitor = strapi.plugin('offline-sync').service('connectivity-monitor');
      // In Strapi 5, use strapi.config.get with plugin:: namespace
      const pluginConfig = strapi.config.get('plugin::offline-sync', {});

      const pendingCount = pluginConfig.mode === 'replica'
        ? await syncQueue.getPending(pluginConfig.shipId)
        : 0;

      // Check actual connectivity status (do a fresh check for accurate status)
      let isOnline = true;
      if (pluginConfig.mode === 'replica') {
        const result = await connectivityMonitor.checkConnectivity();
        isOnline = result.isOnline;
      }

      ctx.body = {
        mode: pluginConfig.mode,
        shipId: pluginConfig.shipId,
        queueSize: pendingCount,
        connectivity: isOnline ? 'online' : 'offline',
      };
    } catch (error: any) {
      ctx.throw(500, error);
    }
  },

  async push(ctx: any) {
    try {
      const syncService = strapi.plugin('offline-sync').service('sync-service');
      const result = await syncService.push();

      ctx.body = {
        success: true,
        ...result,
      };
    } catch (error: any) {
      ctx.throw(500, error);
    }
  },

  async pull(ctx: any) {
    try {
      const syncService = strapi.plugin('offline-sync').service('sync-service');
      const result = await syncService.pull();

      ctx.body = {
        success: true,
        ...result,
      };
    } catch (error: any) {
      ctx.throw(500, error);
    }
  },

  async getQueue(ctx: any) {
    try {
      const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
      const pluginConfig = strapi.config.get('plugin::offline-sync', {});

      if (pluginConfig.mode !== 'replica') {
        ctx.body = { queue: [] };
        return;
      }

      const queue = await syncQueue.getQueue(pluginConfig.shipId);
      ctx.body = { queue };
    } catch (error: any) {
      ctx.throw(500, error);
    }
  },

  async getPending(ctx: any) {
    try {
      const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
      const pluginConfig = strapi.config.get('plugin::offline-sync', {});

      if (pluginConfig.mode !== 'replica') {
        ctx.body = { pending: [] };
        return;
      }

      const pending = await syncQueue.getPending(pluginConfig.shipId);
      ctx.body = { pending };
    } catch (error: any) {
      ctx.throw(500, error);
    }
  },

  async getShips(ctx: any) {
    try {
      const pluginConfig = strapi.config.get('plugin::offline-sync', {});

      if (pluginConfig.mode !== 'master') {
        ctx.throw(403, 'Only master instance can list ships');
        return;
      }

      const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');
      const ships = await shipTracker.listShips();

      // Transform camelCase to snake_case for frontend compatibility
      const transformedShips = ships.map((ship: any) => ({
        id: ship.id,
        ship_id: ship.shipId,
        ship_name: ship.shipName,
        connectivity_status: ship.connectivityStatus,
        last_seen_at: ship.lastSeenAt,
        created_at: ship.createdAt,
        updated_at: ship.updatedAt,
      }));

      ctx.body = { ships: transformedShips };
    } catch (error: any) {
      ctx.throw(500, error);
    }
  },
};

