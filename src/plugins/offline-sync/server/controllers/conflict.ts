export default ({ strapi }: { strapi: any }) => ({
    /**
     * List all conflicts
     * GET /api/sync/conflicts
     */
    async list(ctx: any) {
        const conflictResolver = strapi
            .plugin('offline-sync')
            .service('conflict-resolver');

        const conflicts = await conflictResolver.getPendingConflicts();

        ctx.body = {
            conflicts,
        };
    },

    /**
     * Get conflict by ID
     * GET /api/sync/conflicts/:id
     */
    async getOne(ctx: any) {
        const conflictResolver = strapi
            .plugin('offline-sync')
            .service('conflict-resolver');

        const { id } = ctx.params;

        const conflict = await conflictResolver.getConflict(parseInt(id));

        if (!conflict) {
            return ctx.notFound('Conflict not found');
        }

        ctx.body = {
            conflict,
        };
    },

    /**
     * Resolve conflict
     * POST /api/sync/conflicts/:id/resolve
     */
    async resolve(ctx: any) {
        const conflictResolver = strapi
            .plugin('offline-sync')
            .service('conflict-resolver');

        const { id } = ctx.params;
        const { resolution, mergedData } = ctx.request.body;

        if (!resolution) {
            return ctx.badRequest('resolution is required');
        }

        if (!['keep_local', 'keep_remote', 'merge'].includes(resolution)) {
            return ctx.badRequest(
                'resolution must be one of: keep_local, keep_remote, merge'
            );
        }

        if (resolution === 'merge' && !mergedData) {
            return ctx.badRequest('mergedData is required when resolution is merge');
        }

        const userId = ctx.state.user?.id;

        try {
            await conflictResolver.resolveConflict(
                parseInt(id),
                resolution,
                mergedData,
                userId
            );

            ctx.body = {
                success: true,
            };
        } catch (error: any) {
            return ctx.badRequest(error.message || 'Failed to resolve conflict');
        }
    },
});

