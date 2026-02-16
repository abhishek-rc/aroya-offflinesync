export default ({ strapi }: { strapi: any }) => ({
    /**
     * Push changes from ship to master
     * POST /api/sync/push
     */
    async push(ctx: any) {
        const pluginConfig = strapi.plugin('offline-sync').config;
        const syncService = strapi.plugin('offline-sync').service('sync-service');
        const conflictResolver = strapi
            .plugin('offline-sync')
            .service('conflict-resolver');
        const versionTracker = strapi
            .plugin('offline-sync')
            .service('version-tracker');
        const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');

        // Only master can receive pushes
        if (pluginConfig.mode !== 'master') {
            return ctx.forbidden('Only master instance can receive pushes');
        }

        const { shipId, changes } = ctx.request.body;

        if (!shipId || !changes || !Array.isArray(changes)) {
            return ctx.badRequest('Invalid request: shipId and changes array required');
        }

        // Record ship activity (ship is online)
        await shipTracker.recordShipActivity(shipId, {
            ip: ctx.request.ip,
            userAgent: ctx.request.headers['user-agent'],
            lastAction: 'push',
        });

        let processed = 0;
        let conflicts = 0;
        const updatedEntities: any[] = [];

        // Process each change
        for (const change of changes) {
            const { contentType, entityId, data, operation, version } = change;

            try {
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
                if (localEntity && localMetadata) {
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

                        conflicts++;
                        continue;
                    }
                }

                // Apply the change
                switch (operation) {
                    case 'create':
                        if (!localEntity) {
                            const created = await strapi.entityService.create(contentType, {
                                data,
                            });
                            await versionTracker.incrementVersion(
                                contentType,
                                entityId || created.id,
                                `ship-${shipId}`
                            );
                            updatedEntities.push({
                                contentType,
                                entityId: entityId || created.id,
                                data: created,
                            });
                            processed++;
                        }
                        break;

                    case 'update':
                        if (localEntity) {
                            const updated = await strapi.entityService.update(
                                contentType,
                                entityId,
                                { data }
                            );
                            await versionTracker.incrementVersion(
                                contentType,
                                entityId,
                                `ship-${shipId}`
                            );
                            updatedEntities.push({
                                contentType,
                                entityId,
                                data: updated,
                            });
                            processed++;
                        }
                        break;

                    case 'delete':
                        if (localEntity) {
                            await strapi.entityService.delete(contentType, entityId);
                            processed++;
                        }
                        break;
                }
            } catch (error: any) {
                strapi.log.error(`Error processing change: ${error.message}`);
                // Continue with next change
            }
        }

        // Update ship sync status
        await shipTracker.updateShipSyncStatus(
            shipId,
            conflicts > 0 ? 'partial' : 'success',
            processed
        );

        ctx.body = {
            success: true,
            processed,
            conflicts,
            updatedEntities,
        };
    },

    /**
     * Pull changes from master
     * GET /api/sync/pull
     */
    async pull(ctx: any) {
        const pluginConfig = strapi.plugin('offline-sync').config;
        const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');

        // Only master can serve pulls
        if (pluginConfig.mode !== 'master') {
            return ctx.forbidden('Only master instance can serve pulls');
        }

        const { shipId, lastSyncTimestamp } = ctx.query;

        if (!shipId) {
            return ctx.badRequest('shipId is required');
        }

        // Record ship activity (ship is online)
        await shipTracker.recordShipActivity(shipId, {
            ip: ctx.request.ip,
            userAgent: ctx.request.headers['user-agent'],
            lastAction: 'pull',
        });

        const syncMetadata = strapi.db.query('plugin::offline-sync.sync-metadata');

        // Query changes since lastSyncTimestamp
        const where: any = {};

        if (lastSyncTimestamp) {
            where.lastSyncedAt = { $gt: new Date(lastSyncTimestamp) };
        } else {
            // If no lastSyncTimestamp, get all entities that have been synced
            // This ensures we don't miss any entities
            where.lastSyncedAt = { $notNull: true };
        }

        // Get all content types that have sync metadata and were modified
        const metadataEntries = await syncMetadata.findMany({
            where,
            orderBy: { lastSyncedAt: 'asc' },
        });

        // Group by content type and get actual entities
        const changes: any[] = [];
        const seenEntities = new Set<string>();

        for (const metadata of metadataEntries) {
            const entityKey = `${metadata.contentType}:${metadata.entityId}`;

            // Skip if we've already seen this entity
            if (seenEntities.has(entityKey)) {
                continue;
            }
            seenEntities.add(entityKey);

            try {
                const entity = await strapi.entityService.findOne(
                    metadata.contentType,
                    metadata.entityId
                );

                if (entity) {
                    changes.push({
                        operation: 'update',
                        contentType: metadata.contentType,
                        entityId: metadata.entityId,
                        data: entity,
                        version: metadata.syncVersion,
                    });
                } else {
                    // Entity was deleted, include delete operation
                    changes.push({
                        operation: 'delete',
                        contentType: metadata.contentType,
                        entityId: metadata.entityId,
                        data: null,
                        version: metadata.syncVersion,
                    });
                }
            } catch (error: any) {
                strapi.log.error(
                    `Error fetching entity for sync: ${error.message}`
                );
            }
        }

        // Update ship sync status
        await shipTracker.updateShipSyncStatus(shipId, 'success', changes.length);

        ctx.body = {
            changes,
            hasMore: false, // Could implement pagination if needed
        };
    },

    /**
     * Get sync status
     * GET /api/sync/status
     */
    async status(ctx: any) {
        const pluginConfig = strapi.plugin('offline-sync').config;
        const queueManager = strapi.plugin('offline-sync').service('queue-manager');
        const syncService = strapi.plugin('offline-sync').service('sync-service');
        const conflictResolver = strapi
            .plugin('offline-sync')
            .service('conflict-resolver');
        const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');
        const connectivityTracker = strapi
            .plugin('offline-sync')
            .service('connectivity-tracker');

        const queueSize = await queueManager.getQueueSize();
        const lastSync = await syncService.getLastSyncTimestamp();

        let isOnline: boolean;
        let connectivityState: any = null;

        if (pluginConfig.mode === 'replica') {
            // For replica, get detailed connectivity state
            connectivityState = connectivityTracker.getConnectivityState();
            isOnline = connectivityState.isOnline;
        } else {
            // For master, always online
            isOnline = true;
        }

        let pendingConflicts = 0;
        let ships: any[] = [];

        if (pluginConfig.mode === 'master') {
            const conflicts = await conflictResolver.getPendingConflicts();
            pendingConflicts = conflicts.length;
            // Get all ships status
            ships = await shipTracker.getAllShipsStatus();
        }

        ctx.body = {
            mode: pluginConfig.mode,
            queueSize,
            lastSync,
            isOnline,
            pendingConflicts,
            syncInProgress: false, // Could track this with a flag
            ...(pluginConfig.mode === 'replica' && { connectivity: connectivityState }), // Include connectivity details for replica
            ...(pluginConfig.mode === 'master' && { ships }), // Include ships list for master
        };
    },

    /**
     * Get ship status (master only)
     * GET /api/sync/ships/:shipId
     */
    async getShipStatus(ctx: any) {
        const pluginConfig = strapi.plugin('offline-sync').config;
        const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');

        // Only master can check ship status
        if (pluginConfig.mode !== 'master') {
            return ctx.forbidden('Only master instance can check ship status');
        }

        const { shipId } = ctx.params;

        if (!shipId) {
            return ctx.badRequest('shipId is required');
        }

        const status = await shipTracker.getShipStatus(shipId);

        if (!status) {
            return ctx.notFound('Ship not found');
        }

        ctx.body = { ship: status };
    },

    /**
     * List all ships (master only)
     * GET /api/sync/ships
     */
    async listShips(ctx: any) {
        const pluginConfig = strapi.plugin('offline-sync').config;
        const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');

        // Only master can list ships
        if (pluginConfig.mode !== 'master') {
            return ctx.forbidden('Only master instance can list ships');
        }

        const ships = await shipTracker.getAllShipsStatus();

        ctx.body = { ships };
    },

    /**
     * Manual sync trigger (replica only)
     * POST /api/sync/sync
     */
    async manualSync(ctx: any) {
        const pluginConfig = strapi.plugin('offline-sync').config;
        const syncService = strapi.plugin('offline-sync').service('sync-service');

        // Only replica can trigger manual sync
        if (pluginConfig.mode !== 'replica') {
            return ctx.forbidden('Manual sync only available in replica mode');
        }

        try {
            const result = await syncService.sync();

            ctx.body = {
                success: result.success,
                pushed: result.pushed,
                pulled: result.pulled,
                conflicts: result.conflicts,
                errors: result.errors || [],
            };
        } catch (error: any) {
            return ctx.internalServerError(
                error.message || 'Failed to sync'
            );
        }
    },
});

