/**
 * Ship Tracker Service
 * Uses strapi.db.query() for reliable database operations in async contexts
 * (Document Service can have issues when called from Kafka consumer callbacks)
 */

const CONTENT_TYPE = 'plugin::offline-sync.ship-registry';

interface Ship {
  id: number;
  documentId: string;
  shipId: string;
  shipName: string;
  connectivityStatus: 'online' | 'offline';
  lastSeenAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export default ({ strapi: strapiParam }: { strapi: any }) => {
  // Explicitly capture strapi in closure to ensure it's available
  const strapi = strapiParam;

  // Helper to generate a document ID (Strapi 5 format)
  const generateDocumentId = () => {
    return `${Date.now().toString(36)}${Math.random().toString(36).substr(2, 9)}`;
  };

  return {
    /**
     * Register or update a ship
     * Uses strapi.db.query() for reliable async context operations
     */
    async registerShip(shipId: string, shipName?: string): Promise<Ship | null> {
      if (!shipId) {
        if (strapi && strapi.log) {
          strapi.log.warn('[ShipTracker] shipId is required');
        }
        return null;
      }

      if (!strapi || !strapi.db) {
        console.error('[ShipTracker] Strapi instance or db is not available');
        return null;
      }

      // Check if shutting down or connection unavailable
      if ((strapi as any)._isShuttingDown) {
        return null;
      }

      // Check if connection is still valid
      try {
        const connection = strapi.db.connection;
        if (!connection || connection.destroyed) {
          strapi.log?.debug('[ShipTracker] DB connection unavailable for registerShip');
          return null;
        }
      } catch {
        return null;
      }

      try {
        const now = new Date();

        // Check if ship exists using db.query
        const existing = await strapi.db.query(CONTENT_TYPE).findOne({
          where: { shipId },
        });

        if (existing) {
          // Update existing ship
          const updated = await strapi.db.query(CONTENT_TYPE).update({
            where: { id: existing.id },
            data: {
              connectivityStatus: 'online',
              lastSeenAt: now,
              updatedAt: now,
            },
          });
          if (strapi.log) {
            strapi.log.debug(`[ShipTracker] Updated ship ${shipId} - last seen: ${now.toISOString()}`);
          }
          return updated as Ship;
        }

        // Create new ship using db.query
        const created = await strapi.db.query(CONTENT_TYPE).create({
          data: {
            documentId: generateDocumentId(),
            shipId,
            shipName: shipName || shipId,
            connectivityStatus: 'online',
            lastSeenAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });

        if (strapi.log) {
          strapi.log.info(`[ShipTracker] ✅ New ship registered: ${shipId} (${shipName || shipId})`);
        }
        return created as Ship;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const stack = error instanceof Error ? error.stack : undefined;
        if (strapi && strapi.log) {
          strapi.log.error(`[ShipTracker] ❌ Failed to register ship ${shipId}: ${message}`);
          if (stack) {
            strapi.log.debug(`[ShipTracker] Error stack: ${stack}`);
          }
        } else {
          console.error(`[ShipTracker] ❌ Failed to register ship ${shipId}: ${message}`);
        }
        throw error;
      }
    },

    /**
     * List all registered ships
     */
    async listShips(): Promise<Ship[]> {
      if (!strapi || !strapi.db) {
        console.error('[ShipTracker] Strapi instance not available');
        return [];
      }
      try {
        const result = await strapi.db.query(CONTENT_TYPE).findMany({
          orderBy: { lastSeenAt: 'desc' },
        });
        return result as Ship[];
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[ShipTracker] Failed to list ships: ${message}`);
        }
        return [];
      }
    },

    /**
     * Get a specific ship by shipId
     */
    async getShip(shipId: string): Promise<Ship | null> {
      if (!strapi || !strapi.db) {
        console.error('[ShipTracker] Strapi instance not available');
        return null;
      }
      try {
        const result = await strapi.db.query(CONTENT_TYPE).findOne({
          where: { shipId },
        });
        return result as Ship | null;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[ShipTracker] Failed to get ship ${shipId}: ${message}`);
        }
        return null;
      }
    },

    /**
     * Mark ships as offline if not seen recently
     */
    async markOfflineShips(thresholdMinutes: number = 5): Promise<number> {
      // Skip if strapi is shutting down or db is not available
      if (!strapi || !strapi.db || (strapi as any)._isShuttingDown) {
        return 0;
      }

      // Check if connection is still valid
      try {
        const connection = strapi.db.connection;
        if (!connection || connection.destroyed) {
          return 0;
        }
      } catch {
        return 0;
      }

      try {
        const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

        // Find online ships that haven't been seen recently
        const staleShips = await strapi.db.query(CONTENT_TYPE).findMany({
          where: {
            connectivityStatus: 'online',
            lastSeenAt: { $lt: threshold },
          },
        });

        // Update each to offline
        let count = 0;
        for (const ship of staleShips) {
          await strapi.db.query(CONTENT_TYPE).update({
            where: { id: ship.id },
            data: {
              connectivityStatus: 'offline',
              updatedAt: new Date(),
            },
          });
          count++;
        }

        if (count > 0 && strapi.log) {
          strapi.log.info(`[ShipTracker] Marked ${count} ships as offline`);
        }

        return count;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Use debug level for connection errors (expected during shutdown)
        if (strapi?.log?.debug && (message.includes('connection') || message.includes('Connection'))) {
          strapi.log.debug(`[ShipTracker] Cleanup skipped (connection unavailable)`);
        } else if (strapi?.log?.error) {
          strapi.log.error(`[ShipTracker] Failed to mark offline ships: ${message}`);
        }
        return 0;
      }
    },

    /**
     * Get ship statistics
     */
    async getStats(): Promise<{ total: number; online: number; offline: number }> {
      if (!strapi || !strapi.db) {
        return { total: 0, online: 0, offline: 0 };
      }
      try {
        const ships = await strapi.db.query(CONTENT_TYPE).findMany({
          orderBy: { lastSeenAt: 'desc' },
        });
        const online = ships.filter((s: any) => s.connectivityStatus === 'online').length;
        return {
          total: ships.length,
          online,
          offline: ships.length - online,
        };
      } catch (error) {
        return { total: 0, online: 0, offline: 0 };
      }
    },
  };
};
