/**
 * Message Tracker Service
 * Provides idempotency by tracking processed message IDs
 * Uses strapi.db.query() for reliable async context operations
 */

const CONTENT_TYPE = 'plugin::offline-sync.processed-message';

interface ProcessedMessage {
  id: number;
  documentId: string;
  messageId: string;
  shipId: string | null;
  contentType: string | null;
  contentId: string | null;
  operation: string | null;
  status: 'processed' | 'failed';
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageMetadata {
  shipId?: string;
  contentType?: string;
  contentId?: string;
  operation?: string;
}

export default ({ strapi: strapiInstance }: { strapi: any }) => {
  // Capture strapi in closure to ensure it's always available
  const strapi = strapiInstance;

  // Helper to generate a document ID (Strapi 5 format)
  const generateDocumentId = () => {
    return `${Date.now().toString(36)}${Math.random().toString(36).substr(2, 9)}`;
  };

  return {
    /**
     * Check if a message has already been processed
     */
    async isProcessed(messageId: string): Promise<boolean> {
      if (!messageId) return false;
      if (!strapi || !strapi.db) {
        console.error('[MessageTracker] Strapi instance not available');
        return false;
      }

      try {
        const existing = await strapi.db.query(CONTENT_TYPE).findOne({
          where: { messageId },
        });
        return !!existing;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.debug(`[MessageTracker] Check failed for ${messageId}: ${message}`);
        }
        return false;
      }
    },

    /**
     * Mark a message as processed
     */
    async markProcessed(messageId: string, metadata: MessageMetadata = {}): Promise<boolean> {
      if (!messageId) return false;
      if (!strapi || !strapi.db) {
        console.error('[MessageTracker] Strapi instance not available');
        return false;
      }

      try {
        // Check if already exists (idempotent operation)
        const existing = await strapi.db.query(CONTENT_TYPE).findOne({
          where: { messageId },
        });

        if (existing) {
          return false; // Already processed
        }

        const now = new Date();
        await strapi.db.query(CONTENT_TYPE).create({
          data: {
            documentId: generateDocumentId(),
            messageId,
            shipId: metadata.shipId || null,
            contentType: metadata.contentType || null,
            contentId: metadata.contentId || null,
            operation: metadata.operation || null,
            status: 'processed',
            processedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });

        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Unique constraint violation means already processed - this is expected
        if (message.includes('unique') || message.includes('duplicate')) {
          return false;
        }
        if (strapi && strapi.log) {
          strapi.log.error(`[MessageTracker] Failed to mark processed: ${message}`);
        }
        return false;
      }
    },

    /**
     * Mark a message as failed
     */
    async markFailed(messageId: string): Promise<void> {
      if (!messageId) return;
      if (!strapi || !strapi.db) {
        console.error('[MessageTracker] Strapi instance not available');
        return;
      }

      try {
        const existing = await strapi.db.query(CONTENT_TYPE).findOne({
          where: { messageId },
        });

        const now = new Date();
        if (existing) {
          await strapi.db.query(CONTENT_TYPE).update({
            where: { id: existing.id },
            data: { 
              status: 'failed',
              updatedAt: now,
            },
          });
        } else {
          await strapi.db.query(CONTENT_TYPE).create({
            data: {
              documentId: generateDocumentId(),
              messageId,
              status: 'failed',
              processedAt: now,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.debug(`[MessageTracker] Failed to mark as failed: ${message}`);
        }
      }
    },

    /**
     * Cleanup old processed messages (retention policy)
     */
    async cleanup(retentionDays: number = 7): Promise<number> {
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
        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        const oldMessages = await strapi.db.query(CONTENT_TYPE).findMany({
          where: {
            processedAt: { $lt: cutoffDate },
          },
          limit: 1000,
        });

        for (const msg of oldMessages) {
          await strapi.db.query(CONTENT_TYPE).delete({
            where: { id: msg.id },
          });
        }

        if (oldMessages.length > 0 && strapi.log) {
          strapi.log.info(`[MessageTracker] Cleaned up ${oldMessages.length} old messages`);
        }

        return oldMessages.length;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Use debug level for connection errors (expected during shutdown)
        if (strapi?.log?.debug && (message.includes('connection') || message.includes('Connection'))) {
          strapi.log.debug(`[MessageTracker] Cleanup skipped (connection unavailable)`);
        } else if (strapi?.log?.error) {
          strapi.log.error(`[MessageTracker] Cleanup failed: ${message}`);
        }
        return 0;
      }
    },

    /**
     * Get processing statistics
     */
    async getStats(): Promise<{
      total: number;
      processed: number;
      failed: number;
      lastProcessed: Date | null;
    }> {
      if (!strapi || !strapi.db) {
        return { total: 0, processed: 0, failed: 0, lastProcessed: null };
      }

      try {
        const all = await strapi.db.query(CONTENT_TYPE).findMany({
          orderBy: { processedAt: 'desc' },
          limit: 10000,
        });

        const processed = all.filter((m: ProcessedMessage) => m.status === 'processed').length;
        const failed = all.filter((m: ProcessedMessage) => m.status === 'failed').length;
        const lastProcessed = all.length > 0 ? all[0].processedAt : null;

        return {
          total: all.length,
          processed,
          failed,
          lastProcessed,
        };
      } catch (error) {
        return { total: 0, processed: 0, failed: 0, lastProcessed: null };
      }
    },
  };
};
