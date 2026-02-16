/**
 * Document Mapping Service
 * Maps replica documentIds to master documentIds for proper sync
 * Uses strapi.db.query() for reliable async context operations
 */

const CONTENT_TYPE = 'plugin::offline-sync.document-mapping';

interface DocumentMapping {
    id: number;
    documentId: string;
    shipId: string;
    contentType: string;
    replicaDocumentId: string;
    masterDocumentId: string;
    lastSyncedBy: string | null;  // ShipId of last ship that synced (for conflict detection)
    createdAt: Date;
    updatedAt: Date;
}

export default ({ strapi: strapiInstance }: { strapi: any }) => {
    // Explicitly capture strapi in closure to ensure it's available in async callbacks
    const strapi = strapiInstance;

    // Helper to generate a document ID (Strapi 5 format)
    const generateDocumentId = () => {
        return `${Date.now().toString(36)}${Math.random().toString(36).substr(2, 9)}`;
    };

    // Helper to check if DB connection is available
    const isDbAvailable = (): boolean => {
        if (!strapi?.db) return false;
        if ((strapi as any)._isShuttingDown) return false;
        try {
            const connection = strapi.db.connection;
            return connection && !connection.destroyed;
        } catch {
            return false;
        }
    };

    return {
        /**
         * Get the full mapping record (includes timestamps for conflict detection)
         */
        async getMapping(
            shipId: string,
            contentType: string,
            replicaDocumentId: string
        ): Promise<DocumentMapping | null> {
            if (!isDbAvailable()) {
                return null;
            }

            try {
                const mapping = await strapi.db.query(CONTENT_TYPE).findOne({
                    where: {
                        shipId,
                        contentType,
                        replicaDocumentId,
                    },
                });
                return mapping as DocumentMapping | null;
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                if (strapi?.log && !message.includes('connection')) {
                    strapi.log.error(`[DocumentMapping] Failed to get mapping: ${message}`);
                }
                return null;
            }
        },

        /**
         * Get master documentId for a replica documentId
         */
        async getMasterDocumentId(
            shipId: string,
            contentType: string,
            replicaDocumentId: string
        ): Promise<string | null> {
            const mapping = await this.getMapping(shipId, contentType, replicaDocumentId);
            return mapping?.masterDocumentId || null;
        },

        /**
         * Create or update a document mapping
         * @param lastSyncedBy - ShipId that performed this sync (for conflict detection)
         */
        async setMapping(
            shipId: string,
            contentType: string,
            replicaDocumentId: string,
            masterDocumentId: string,
            lastSyncedBy?: string  // Optional: which ship performed this sync
        ): Promise<DocumentMapping | null> {
            if (!isDbAvailable()) {
                return null;
            }

            try {
                // Check if mapping exists
                const existing = await strapi.db.query(CONTENT_TYPE).findOne({
                    where: {
                        shipId,
                        contentType,
                        replicaDocumentId,
                    },
                });

                const now = new Date();
                // Use provided lastSyncedBy, or default to the shipId
                const syncedBy = lastSyncedBy || shipId;

                if (existing) {
                    // Update existing mapping
                    const updated = await strapi.db.query(CONTENT_TYPE).update({
                        where: { id: existing.id },
                        data: { 
                            masterDocumentId,
                            lastSyncedBy: syncedBy,
                            updatedAt: now,
                        },
                    });
                    return updated as DocumentMapping;
                }

                // Create new mapping
                const created = await strapi.db.query(CONTENT_TYPE).create({
                    data: {
                        documentId: generateDocumentId(),
                        shipId,
                        contentType,
                        replicaDocumentId,
                        masterDocumentId,
                        lastSyncedBy: syncedBy,
                        createdAt: now,
                        updatedAt: now,
                    },
                });

                if (strapi?.log) {
                    strapi.log.debug(`[DocumentMapping] Created mapping: ${replicaDocumentId} -> ${masterDocumentId} (by ${syncedBy})`);
                }
                return created as DocumentMapping;
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                if (strapi?.log && !message.includes('connection')) {
                    strapi.log.error(`[DocumentMapping] Failed to set mapping: ${message}`);
                }
                return null;
            }
        },

        /**
         * Delete a document mapping
         */
        async deleteMapping(
            shipId: string,
            contentType: string,
            replicaDocumentId: string
        ): Promise<boolean> {
            if (!isDbAvailable()) {
                return false;
            }

            try {
                const existing = await strapi.db.query(CONTENT_TYPE).findOne({
                    where: {
                        shipId,
                        contentType,
                        replicaDocumentId,
                    },
                });

                if (existing) {
                    await strapi.db.query(CONTENT_TYPE).delete({
                        where: { id: existing.id },
                    });
                    return true;
                }

                return false;
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                if (strapi?.log && !message.includes('connection')) {
                    strapi.log.error(`[DocumentMapping] Failed to delete mapping: ${message}`);
                }
                return false;
            }
        },

        /**
         * Get all mappings for a ship
         */
        async getMappingsForShip(shipId: string): Promise<DocumentMapping[]> {
            if (!isDbAvailable()) {
                return [];
            }

            try {
                const mappings = await strapi.db.query(CONTENT_TYPE).findMany({
                    where: { shipId },
                });
                return mappings as DocumentMapping[];
            } catch (error: unknown) {
                return [];
            }
        },

        /**
         * Find mapping by master documentId (reverse lookup)
         * Used when replica receives updates from master
         */
        async findByMasterDocumentId(
            shipId: string,
            contentType: string,
            masterDocumentId: string
        ): Promise<DocumentMapping | null> {
            if (!isDbAvailable()) {
                return null;
            }

            try {
                const mapping = await strapi.db.query(CONTENT_TYPE).findOne({
                    where: {
                        shipId,
                        contentType,
                        masterDocumentId,
                    },
                });
                return mapping as DocumentMapping | null;
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                if (strapi?.log && !message.includes('connection')) {
                    strapi.log.error(`[DocumentMapping] Failed to find by master ID: ${message}`);
                }
                return null;
            }
        },
    };
};

