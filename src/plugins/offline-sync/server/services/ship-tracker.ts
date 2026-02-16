export default ({ strapi }: { strapi: any }) => {
    // Define isShipOnline first so it can be used by other methods
    const isShipOnline = async (shipId: string): Promise<boolean> => {
        const syncSession = strapi.db.query('plugin::offline-sync.sync-session');

        const session = await syncSession.findOne({
            where: { shipId },
        });

        if (!session) {
            return false;
        }

        // Check if last seen is within threshold
        const now = new Date();
        const threshold = session.onlineThreshold || 300000; // 5 minutes default
        const timeSinceLastSeen = now.getTime() - new Date(session.lastSeenAt).getTime();

        const isOnline = timeSinceLastSeen < threshold;

        // Update online status if changed
        if (session.isOnline !== isOnline) {
            await syncSession.update({
                where: { id: session.id },
                data: { isOnline },
            });
        }

        return isOnline;
    };

    return {
        /**
         * Record ship activity (called when ship connects)
         */
        async recordShipActivity(
            shipId: string,
            metadata?: any
        ): Promise<void> {
            const syncSession = strapi.db.query('plugin::offline-sync.sync-session');

            // Find or create session
            let session = await syncSession.findOne({
                where: { shipId },
            });

            const now = new Date();

            if (session) {
                // Update existing session
                await syncSession.update({
                    where: { id: session.id },
                    data: {
                        lastSeenAt: now,
                        isOnline: true,
                        metadata: metadata || session.metadata,
                    },
                });
            } else {
                // Create new session
                await syncSession.create({
                    data: {
                        shipId,
                        lastSeenAt: now,
                        isOnline: true,
                        onlineThreshold: 300000, // 5 minutes default
                        totalSyncs: 0,
                        metadata: metadata || {},
                    },
                });
            }
        },

        /**
         * Update ship sync status
         */
        async updateShipSyncStatus(
            shipId: string,
            status: 'success' | 'failed' | 'partial',
            syncCount?: number
        ): Promise<void> {
            const syncSession = strapi.db.query('plugin::offline-sync.sync-session');

            const session = await syncSession.findOne({
                where: { shipId },
            });

            if (session) {
                await syncSession.update({
                    where: { id: session.id },
                    data: {
                        lastSyncAt: new Date(),
                        lastSyncStatus: status,
                        totalSyncs: syncCount
                            ? session.totalSyncs + syncCount
                            : session.totalSyncs + 1,
                    },
                });
            }
        },

        /**
         * Get ship status
         */
        async getShipStatus(shipId: string): Promise<any> {
            const syncSession = strapi.db.query('plugin::offline-sync.sync-session');

            const session = await syncSession.findOne({
                where: { shipId },
            });

            if (!session) {
                return null;
            }

            const isOnline = await isShipOnline(shipId);

            return {
                shipId: session.shipId,
                isOnline,
                lastSeenAt: session.lastSeenAt,
                lastSyncAt: session.lastSyncAt,
                totalSyncs: session.totalSyncs,
                lastSyncStatus: session.lastSyncStatus,
                metadata: session.metadata,
            };
        },

        /**
         * Get all ships and their status
         */
        async getAllShipsStatus(): Promise<any[]> {
            const syncSession = strapi.db.query('plugin::offline-sync.sync-session');

            const sessions = await syncSession.findMany({
                orderBy: { lastSeenAt: 'desc' },
            });

            const ships: any[] = [];

            for (const session of sessions) {
                const isOnline = await isShipOnline(session.shipId);

                ships.push({
                    shipId: session.shipId,
                    isOnline,
                    lastSeenAt: session.lastSeenAt,
                    lastSyncAt: session.lastSyncAt,
                    totalSyncs: session.totalSyncs,
                    lastSyncStatus: session.lastSyncStatus,
                    metadata: session.metadata,
                });
            }

            return ships;
        },

        /**
         * Mark ship as offline (cleanup old sessions)
         */
        async markOfflineShips(): Promise<void> {
            const syncSession = strapi.db.query('plugin::offline-sync.sync-session');

            const sessions = await syncSession.findMany({
                where: { isOnline: true },
            });

            const now = new Date();

            for (const session of sessions) {
                const threshold = session.onlineThreshold || 300000; // 5 minutes
                const timeSinceLastSeen =
                    now.getTime() - new Date(session.lastSeenAt).getTime();

                if (timeSinceLastSeen >= threshold) {
                    await syncSession.update({
                        where: { id: session.id },
                        data: { isOnline: false },
                    });
                }
            }
        },

        isShipOnline,
    };
};

