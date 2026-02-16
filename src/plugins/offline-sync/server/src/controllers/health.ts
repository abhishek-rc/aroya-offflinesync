/**
 * Health Check Controller
 * Provides endpoints for monitoring and orchestration (K8s, Docker, etc.)
 */
export default ({ strapi }: { strapi: any }) => ({
    /**
     * Liveness probe - is the service running?
     * Returns 200 if the process is alive
     */
    async liveness(ctx: any) {
        ctx.body = {
            status: 'ok',
            timestamp: new Date().toISOString(),
        };
    },

    /**
     * Readiness probe - is the service ready to accept traffic?
     * Checks database and Kafka connectivity
     */
    async readiness(ctx: any) {
        const checks: Record<string, { status: string; latency?: number; error?: string }> = {};
        let isReady = true;

        // Check database
        const dbStart = Date.now();
        try {
            await strapi.db.connection.raw('SELECT 1');
            checks.database = {
                status: 'healthy',
                latency: Date.now() - dbStart,
            };
        } catch (error: any) {
            checks.database = {
                status: 'unhealthy',
                error: error.message,
            };
            isReady = false;
        }

        // Check Kafka (mode-dependent)
        const config = strapi.config.get('plugin::offline-sync', {});
        const kafkaStart = Date.now();

        if (config.mode === 'master') {
            const kafkaConsumer = strapi.plugin('offline-sync').service('kafka-consumer');
            checks.kafka = {
                status: kafkaConsumer.isConnected() ? 'healthy' : 'degraded',
                latency: Date.now() - kafkaStart,
            };
        } else if (config.mode === 'replica') {
            const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
            checks.kafka = {
                status: kafkaProducer.isConnected() ? 'healthy' : 'degraded',
                latency: Date.now() - kafkaStart,
            };
        }

        ctx.status = isReady ? 200 : 503;
        ctx.body = {
            status: isReady ? 'ready' : 'not_ready',
            timestamp: new Date().toISOString(),
            checks,
        };
    },

    /**
     * Detailed health check - full system status
     */
    async health(ctx: any) {
        const config = strapi.config.get('plugin::offline-sync', {});
        const checks: Record<string, any> = {};
        let overallStatus = 'healthy';

        // Database check
        try {
            const dbStart = Date.now();
            await strapi.db.connection.raw('SELECT 1');
            checks.database = {
                status: 'healthy',
                latency: Date.now() - dbStart,
                type: strapi.db.connection.client?.config?.client || 'unknown',
            };
        } catch (error: any) {
            checks.database = { status: 'unhealthy', error: error.message };
            overallStatus = 'unhealthy';
        }

        // Kafka check
        try {
            if (config.mode === 'master') {
                const kafkaConsumer = strapi.plugin('offline-sync').service('kafka-consumer');
                checks.kafka = {
                    status: kafkaConsumer.isConnected() ? 'healthy' : 'degraded',
                    role: 'consumer',
                    topics: config.kafka?.topics?.shipUpdates || 'ship-updates',
                };
            } else {
                const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
                checks.kafka = {
                    status: kafkaProducer.isConnected() ? 'healthy' : 'degraded',
                    role: 'producer',
                };
            }
            if (checks.kafka.status === 'degraded') {
                overallStatus = overallStatus === 'unhealthy' ? 'unhealthy' : 'degraded';
            }
        } catch (error: any) {
            checks.kafka = { status: 'unknown', error: error.message };
        }

        // Message tracker stats
        try {
            const messageTracker = strapi.plugin('offline-sync').service('message-tracker');
            const stats = await messageTracker.getStats();
            checks.messageTracker = {
                status: 'healthy',
                ...stats,
            };
        } catch (error: any) {
            checks.messageTracker = { status: 'unknown', error: error.message };
        }

        // Dead letter queue stats
        try {
            const deadLetter = strapi.plugin('offline-sync').service('dead-letter');
            const stats = await deadLetter.getStats();
            checks.deadLetterQueue = {
                status: stats.exhausted > 0 ? 'warning' : 'healthy',
                ...stats,
            };
            if (stats.exhausted > 0) {
                overallStatus = overallStatus === 'unhealthy' ? 'unhealthy' : 'degraded';
            }
        } catch (error: any) {
            checks.deadLetterQueue = { status: 'unknown', error: error.message };
        }

        // Ship tracker (master only)
        if (config.mode === 'master') {
            try {
                const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');
                const ships = await shipTracker.listShips();
                const online = ships.filter((s: any) => s.connectivity_status === 'online').length;
                checks.ships = {
                    status: 'healthy',
                    total: ships.length,
                    online,
                    offline: ships.length - online,
                };
            } catch (error: any) {
                checks.ships = { status: 'unknown', error: error.message };
            }
        }

        // Sync queue (replica only)
        if (config.mode === 'replica') {
            try {
                const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
                const pending = await syncQueue.getPending(config.shipId);
                checks.syncQueue = {
                    status: pending > 1000 ? 'degraded' : 'healthy',
                    pending,
                };
                if (pending > 1000) {
                    overallStatus = overallStatus === 'unhealthy' ? 'unhealthy' : 'degraded';
                }
            } catch (error: any) {
                checks.syncQueue = { status: 'unknown', error: error.message };
            }
        }

        ctx.body = {
            status: overallStatus,
            mode: config.mode,
            shipId: config.shipId || null,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: strapi.config.get('info.version') || 'unknown',
            checks,
        };
    },

    /**
     * Metrics endpoint (Prometheus-compatible format)
     */
    async metrics(ctx: any) {
        const config = strapi.config.get('plugin::offline-sync', {});
        const lines: string[] = [];

        // Basic info
        lines.push(`# HELP offline_sync_info Plugin information`);
        lines.push(`# TYPE offline_sync_info gauge`);
        lines.push(`offline_sync_info{mode="${config.mode}",ship_id="${config.shipId || 'master'}"} 1`);

        // Uptime
        lines.push(`# HELP offline_sync_uptime_seconds Process uptime in seconds`);
        lines.push(`# TYPE offline_sync_uptime_seconds gauge`);
        lines.push(`offline_sync_uptime_seconds ${Math.floor(process.uptime())}`);

        // Message tracker stats
        try {
            const messageTracker = strapi.plugin('offline-sync').service('message-tracker');
            const stats = await messageTracker.getStats();

            lines.push(`# HELP offline_sync_messages_total Total messages processed`);
            lines.push(`# TYPE offline_sync_messages_total counter`);
            lines.push(`offline_sync_messages_total{status="processed"} ${stats.processed}`);
            lines.push(`offline_sync_messages_total{status="failed"} ${stats.failed}`);
        } catch {
            // Skip if not available
        }

        // Ship count (master only)
        if (config.mode === 'master') {
            try {
                const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');
                const ships = await shipTracker.listShips();
                const online = ships.filter((s: any) => s.connectivity_status === 'online').length;

                lines.push(`# HELP offline_sync_ships_total Total registered ships`);
                lines.push(`# TYPE offline_sync_ships_total gauge`);
                lines.push(`offline_sync_ships_total ${ships.length}`);

                lines.push(`# HELP offline_sync_ships_online Ships currently online`);
                lines.push(`# TYPE offline_sync_ships_online gauge`);
                lines.push(`offline_sync_ships_online ${online}`);
            } catch {
                // Skip if not available
            }
        }

        // Pending queue (replica only)
        if (config.mode === 'replica') {
            try {
                const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
                const pending = await syncQueue.getPending(config.shipId);

                lines.push(`# HELP offline_sync_queue_pending Pending items in sync queue`);
                lines.push(`# TYPE offline_sync_queue_pending gauge`);
                lines.push(`offline_sync_queue_pending ${pending}`);
            } catch {
                // Skip if not available
            }
        }

        // Dead letter queue (master only)
        if (config.mode === 'master') {
            try {
                const deadLetter = strapi.plugin('offline-sync').service('dead-letter');
                const stats = await deadLetter.getStats();

                lines.push(`# HELP offline_sync_dead_letter_total Dead letter queue items by status`);
                lines.push(`# TYPE offline_sync_dead_letter_total gauge`);
                lines.push(`offline_sync_dead_letter_total{status="pending"} ${stats.pending}`);
                lines.push(`offline_sync_dead_letter_total{status="retrying"} ${stats.retrying}`);
                lines.push(`offline_sync_dead_letter_total{status="exhausted"} ${stats.exhausted}`);
                lines.push(`offline_sync_dead_letter_total{status="resolved"} ${stats.resolved}`);
            } catch {
                // Skip if not available
            }
        }

        ctx.type = 'text/plain';
        ctx.body = lines.join('\n') + '\n';
    },
});

