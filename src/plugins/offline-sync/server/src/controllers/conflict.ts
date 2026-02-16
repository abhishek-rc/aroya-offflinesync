// Strapi is available globally in controllers
declare const strapi: any;

export default {
  async list(ctx: any) {
    try {
      const conflictResolver = strapi.plugin('offline-sync').service('conflict-resolver');
      const conflicts = await conflictResolver.listConflicts();
      
      ctx.body = { conflicts };
    } catch (error: any) {
      ctx.throw(500, error);
    }
  },

  async get(ctx: any) {
    try {
      const conflictResolver = strapi.plugin('offline-sync').service('conflict-resolver');
      const conflict = await conflictResolver.getConflict(ctx.params.id);
      
      if (!conflict) {
        ctx.throw(404, 'Conflict not found');
        return;
      }
      
      ctx.body = { conflict };
    } catch (error: any) {
      ctx.throw(500, error);
    }
  },

  async resolve(ctx: any) {
    try {
      const conflictResolver = strapi.plugin('offline-sync').service('conflict-resolver');
      const { strategy, data } = ctx.request.body;
      
      const result = await conflictResolver.resolveConflict(
        ctx.params.id,
        strategy,
        data
      );
      
      ctx.body = {
        success: true,
        ...result,
      };
    } catch (error: any) {
      ctx.throw(500, error);
    }
  },
};

