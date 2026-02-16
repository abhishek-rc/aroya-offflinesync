/**
 * Dead Letter Queue Service
 * Handles failed messages for retry or manual resolution
 * Uses strapi.db.query() for reliable async context operations
 */

const CONTENT_TYPE = 'plugin::offline-sync.dead-letter';

interface DeadLetter {
  id: number;
  documentId: string;
  messageId: string;
  shipId: string | null;
  contentType: string | null;
  contentId: string | null;
  operation: string | null;
  payload: Record<string, unknown> | null;
  errorMessage: string | null;
  errorStack: string | null;
  retryCount: number;
  maxRetries: number;
  status: 'pending' | 'retrying' | 'exhausted' | 'resolved';
  lastRetryAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DeadLetterInput {
  messageId: string;
  shipId?: string;
  contentType?: string;
  contentId?: string;
  operation?: string;
  payload?: Record<string, unknown>;
  error: Error | string;
  maxRetries?: number;
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
     * Add a failed message to the dead letter queue
     */
    async add(input: DeadLetterInput): Promise<DeadLetter | null> {
      if (!strapi || !strapi.db) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      if (!input.messageId) {
        if (strapi.log) {
          strapi.log.warn('[DeadLetter] messageId is required');
        }
        return null;
      }

      try {
        const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
        const errorStack = input.error instanceof Error ? input.error.stack : undefined;
        const now = new Date();

        const created = await strapi.db.query(CONTENT_TYPE).create({
          data: {
            documentId: generateDocumentId(),
            messageId: input.messageId,
            shipId: input.shipId || null,
            contentType: input.contentType || null,
            contentId: input.contentId || null,
            operation: input.operation || null,
            payload: input.payload || null,
            errorMessage,
            errorStack: errorStack || null,
            retryCount: 0,
            maxRetries: input.maxRetries ?? 3,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
          },
        });

        if (strapi.log) {
          strapi.log.warn(`[DeadLetter] Message ${input.messageId} added to dead letter queue`);
        }
        return created as DeadLetter;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to add message: ${message}`);
        } else {
          console.error(`[DeadLetter] Failed to add message: ${message}`);
        }
        return null;
      }
    },

    /**
     * Get all pending dead letters for retry
     */
    async getPending(limit: number = 100): Promise<DeadLetter[]> {
      if (!strapi || !strapi.db) {
        console.error('[DeadLetter] Strapi instance not available');
        return [];
      }

      try {
        const result = await strapi.db.query(CONTENT_TYPE).findMany({
          where: {
            status: { $in: ['pending', 'retrying'] },
          },
          orderBy: { createdAt: 'asc' },
          limit,
        });
        return result as DeadLetter[];
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to get pending: ${message}`);
        }
        return [];
      }
    },

    /**
     * Get all dead letters
     */
    async getAll(filters?: { status?: string; shipId?: string }): Promise<DeadLetter[]> {
      if (!strapi || !strapi.db) {
        console.error('[DeadLetter] Strapi instance not available');
        return [];
      }

      try {
        const queryWhere: Record<string, unknown> = {};
        if (filters?.status) {
          queryWhere.status = filters.status;
        }
        if (filters?.shipId) {
          queryWhere.shipId = filters.shipId;
        }

        const result = await strapi.db.query(CONTENT_TYPE).findMany({
          where: queryWhere,
          orderBy: { createdAt: 'desc' },
          limit: 1000,
        });
        return result as DeadLetter[];
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to get all: ${message}`);
        }
        return [];
      }
    },

    /**
     * Get a specific dead letter by id
     */
    async get(id: number): Promise<DeadLetter | null> {
      if (!strapi || !strapi.db) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      try {
        const result = await strapi.db.query(CONTENT_TYPE).findOne({
          where: { id },
        });
        return result as DeadLetter | null;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to get ${id}: ${message}`);
        }
        return null;
      }
    },

    /**
     * Get a specific dead letter by documentId
     */
    async getByDocumentId(documentId: string): Promise<DeadLetter | null> {
      if (!strapi || !strapi.db) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      try {
        const result = await strapi.db.query(CONTENT_TYPE).findOne({
          where: { documentId },
        });
        return result as DeadLetter | null;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to get ${documentId}: ${message}`);
        }
        return null;
      }
    },

    /**
     * Mark a dead letter as being retried
     */
    async markRetrying(id: number): Promise<DeadLetter | null> {
      if (!strapi || !strapi.db) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      try {
        const existing = await this.get(id);
        if (!existing) return null;

        const newRetryCount = existing.retryCount + 1;
        const status = newRetryCount >= existing.maxRetries ? 'exhausted' : 'retrying';

        const updated = await strapi.db.query(CONTENT_TYPE).update({
          where: { id },
          data: {
            retryCount: newRetryCount,
            status,
            lastRetryAt: new Date(),
            updatedAt: new Date(),
          },
        });

        return updated as DeadLetter;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to mark retrying: ${message}`);
        }
        return null;
      }
    },

    /**
     * Mark a dead letter as resolved (successfully processed on retry)
     */
    async markResolved(id: number, resolvedBy?: string): Promise<DeadLetter | null> {
      if (!strapi || !strapi.db) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      try {
        const updated = await strapi.db.query(CONTENT_TYPE).update({
          where: { id },
          data: {
            status: 'resolved',
            resolvedAt: new Date(),
            resolvedBy: resolvedBy || 'system',
            updatedAt: new Date(),
          },
        });

        if (strapi.log) {
          strapi.log.info(`[DeadLetter] Message ${id} resolved`);
        }
        return updated as DeadLetter;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to mark resolved: ${message}`);
        }
        return null;
      }
    },

    /**
     * Mark a dead letter as exhausted (max retries reached)
     */
    async markExhausted(id: number): Promise<DeadLetter | null> {
      if (!strapi || !strapi.db) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      try {
        const updated = await strapi.db.query(CONTENT_TYPE).update({
          where: { id },
          data: { 
            status: 'exhausted',
            updatedAt: new Date(),
          },
        });

        if (strapi.log) {
          strapi.log.warn(`[DeadLetter] Message ${id} exhausted all retries`);
        }
        return updated as DeadLetter;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to mark exhausted: ${message}`);
        }
        return null;
      }
    },

    /**
     * Delete a dead letter
     */
    async delete(id: number): Promise<boolean> {
      if (!strapi || !strapi.db) {
        console.error('[DeadLetter] Strapi instance not available');
        return false;
      }

      try {
        await strapi.db.query(CONTENT_TYPE).delete({ where: { id } });
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to delete: ${message}`);
        }
        return false;
      }
    },

    /**
     * Get dead letter queue statistics
     */
    async getStats(): Promise<{
      total: number;
      pending: number;
      retrying: number;
      exhausted: number;
      resolved: number;
    }> {
      if (!strapi || !strapi.db) {
        return { total: 0, pending: 0, retrying: 0, exhausted: 0, resolved: 0 };
      }

      try {
        const all = await strapi.db.query(CONTENT_TYPE).findMany({
          limit: 10000,
        });

        return {
          total: all.length,
          pending: all.filter((d: DeadLetter) => d.status === 'pending').length,
          retrying: all.filter((d: DeadLetter) => d.status === 'retrying').length,
          exhausted: all.filter((d: DeadLetter) => d.status === 'exhausted').length,
          resolved: all.filter((d: DeadLetter) => d.status === 'resolved').length,
        };
      } catch (error) {
        return { total: 0, pending: 0, retrying: 0, exhausted: 0, resolved: 0 };
      }
    },

    /**
     * Cleanup old resolved dead letters
     */
    async cleanup(retentionDays: number = 30): Promise<number> {
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
            status: 'resolved',
            resolvedAt: { $lt: cutoffDate },
          },
          limit: 500,
        });

        for (const msg of oldMessages) {
          await strapi.db.query(CONTENT_TYPE).delete({
            where: { id: msg.id },
          });
        }

        if (oldMessages.length > 0 && strapi.log) {
          strapi.log.info(`[DeadLetter] Cleaned up ${oldMessages.length} resolved messages`);
        }

        return oldMessages.length;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Use debug level for connection errors (expected during shutdown)
        if (strapi?.log?.debug && (message.includes('connection') || message.includes('Connection'))) {
          strapi.log.debug(`[DeadLetter] Cleanup skipped (connection unavailable)`);
        } else if (strapi?.log?.error) {
          strapi.log.error(`[DeadLetter] Cleanup failed: ${message}`);
        }
        return 0;
      }
    },
  };
};
