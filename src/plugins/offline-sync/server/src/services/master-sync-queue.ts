/**
 * Master Sync Queue Service
 * 
 * Queues Master changes when Kafka is offline.
 * This ensures no data is lost when Master cannot reach Kafka.
 */
export default ({ strapi }: { strapi: any }) => {
  let tableExists: boolean | null = null;
  let editLogTableExists: boolean | null = null;

  return {
    /**
     * Check if master_sync_queue table exists (cached)
     */
    async ensureTable(): Promise<boolean> {
      if (tableExists !== null) return tableExists;
      
      try {
        const db = strapi.db.connection;
        tableExists = await db.schema.hasTable('master_sync_queue');
        return tableExists;
      } catch (error: any) {
        strapi.log.warn(`[MasterQueue] Failed to check table: ${error.message}`);
        return false;
      }
    },

    /**
     * Check if master_edit_log table exists (cached)
     */
    async ensureEditLogTable(): Promise<boolean> {
      if (editLogTableExists !== null) return editLogTableExists;
      
      try {
        const db = strapi.db.connection;
        editLogTableExists = await db.schema.hasTable('master_edit_log');
        return editLogTableExists;
      } catch (error: any) {
        strapi.log.warn(`[MasterQueue] Failed to check edit_log table: ${error.message}`);
        return false;
      }
    },

    /**
     * Enqueue a Master change for later sync to ships
     */
    async enqueue(operation: {
      contentType: string;
      contentId: string;
      operation: 'create' | 'update' | 'delete';
      data: any;
      locale?: string | null;
    }): Promise<any> {
      if (!await this.ensureTable()) {
        strapi.log.warn('[MasterQueue] master_sync_queue table does not exist');
        return null;
      }

      try {
        const db = strapi.db.connection;
        
        const insertData: any = {
          content_type: operation.contentType,
          content_id: String(operation.contentId),
          operation: operation.operation,
          data: operation.data ? JSON.stringify(operation.data) : null,
          locale: operation.locale || null,
          status: 'pending',
          created_at: new Date(),
        };
        
        const [result] = await db('master_sync_queue')
          .insert(insertData)
          .returning('*');

        strapi.log.info(`[MasterQueue] ✅ Queued ${operation.operation} for ${operation.contentType} (${operation.contentId})`);
        return result;
      } catch (error: any) {
        strapi.log.error(`[MasterQueue] Failed to enqueue: ${error.message}`);
        return null;
      }
    },

    /**
     * Dequeue pending operations for sending to ships
     */
    async dequeue(limit: number = 50): Promise<any[]> {
      if (!await this.ensureTable()) {
        return [];
      }

      try {
        const db = strapi.db.connection;
        const entries = await db('master_sync_queue')
          .where({ status: 'pending' })
          .orderBy('created_at', 'asc')
          .limit(limit);

        if (entries.length > 0) {
          await db('master_sync_queue')
            .whereIn('id', entries.map((e: any) => e.id))
            .update({ status: 'sending' });
        }

        return entries.map((entry: any) => ({
          ...entry,
          data: typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data,
        }));
      } catch (error: any) {
        strapi.log.error(`[MasterQueue] Dequeue failed: ${error.message}`);
        return [];
      }
    },

    /**
     * Mark operation as sent successfully
     */
    async markSent(queueId: number): Promise<void> {
      try {
        const db = strapi.db.connection;
        await db('master_sync_queue')
          .where({ id: queueId })
          .update({
            status: 'sent',
            sent_at: new Date(),
          });
      } catch (error: any) {
        strapi.log.error(`[MasterQueue] markSent failed: ${error.message}`);
      }
    },

    /**
     * Mark operation as failed
     */
    async markFailed(queueId: number, error: Error): Promise<void> {
      try {
        const db = strapi.db.connection;
        const entry = await db('master_sync_queue').where({ id: queueId }).first();

        const newRetryCount = (entry?.retry_count || 0) + 1;
        const maxRetries = entry?.max_retries || 5;

        // If max retries exceeded, move to dead letter (or just leave as failed)
        const newStatus = newRetryCount >= maxRetries ? 'failed' : 'pending';

        await db('master_sync_queue')
          .where({ id: queueId })
          .update({
            status: newStatus,
            error_message: error.message,
            retry_count: newRetryCount,
          });
      } catch (err: any) {
        strapi.log.error(`[MasterQueue] markFailed error: ${err.message}`);
      }
    },

    /**
     * Get count of pending operations
     */
    async getPendingCount(): Promise<number> {
      if (!await this.ensureTable()) {
        return 0;
      }

      try {
        const db = strapi.db.connection;
        const [result] = await db('master_sync_queue')
          .where({ status: 'pending' })
          .count('* as count');

        return parseInt(result.count as string) || 0;
      } catch (error: any) {
        return 0;
      }
    },

    /**
     * Get queue statistics
     */
    async getStats(): Promise<{
      pending: number;
      sending: number;
      sent: number;
      failed: number;
      total: number;
    }> {
      if (!await this.ensureTable()) {
        return { pending: 0, sending: 0, sent: 0, failed: 0, total: 0 };
      }

      try {
        const db = strapi.db.connection;
        const results = await db('master_sync_queue')
          .select('status')
          .count('* as count')
          .groupBy('status');

        const stats: any = { pending: 0, sending: 0, sent: 0, failed: 0, total: 0 };

        for (const row of results) {
          const status = row.status as string;
          const count = parseInt(row.count as string) || 0;
          stats[status] = count;
          stats.total += count;
        }

        return stats;
      } catch (error: any) {
        return { pending: 0, sending: 0, sent: 0, failed: 0, total: 0 };
      }
    },

    /**
     * Cleanup old sent entries (keep last N days)
     */
    async cleanup(daysToKeep: number = 7): Promise<number> {
      if (!await this.ensureTable()) {
        return 0;
      }

      try {
        const db = strapi.db.connection;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        const deleted = await db('master_sync_queue')
          .where('status', 'sent')
          .where('sent_at', '<', cutoffDate)
          .delete();

        if (deleted > 0) {
          strapi.log.info(`[MasterQueue] Cleaned up ${deleted} old entries`);
        }

        return deleted;
      } catch (error: any) {
        strapi.log.error(`[MasterQueue] Cleanup failed: ${error.message}`);
        return 0;
      }
    },

    // ========================================================================
    // Master Edit Log - Tracks who made direct edits to Master
    // ========================================================================

    /**
     * Log a Master edit (admin or ship sync)
     * Uses UPSERT to keep only the latest edit per document
     */
    async logEdit(params: {
      contentType: string;
      documentId: string;
      operation: 'create' | 'update' | 'delete';
      editedBy: string;  // 'master-admin' or 'ship-{shipId}'
      locale?: string | null;
    }): Promise<void> {
      if (!await this.ensureEditLogTable()) {
        return;
      }

      try {
        const db = strapi.db.connection;

        // UPSERT: Insert or update on conflict
        await db.raw(`
          INSERT INTO master_edit_log (content_type, document_id, operation, edited_by, locale, edited_at)
          VALUES (?, ?, ?, ?, ?, NOW())
          ON CONFLICT (content_type, document_id) 
          DO UPDATE SET 
            operation = EXCLUDED.operation,
            edited_by = EXCLUDED.edited_by,
            locale = EXCLUDED.locale,
            edited_at = NOW()
        `, [params.contentType, params.documentId, params.operation, params.editedBy, params.locale || null]);

        strapi.log.debug(`[MasterEditLog] Logged ${params.operation} by ${params.editedBy} for ${params.contentType}/${params.documentId}`);
      } catch (error: any) {
        strapi.log.warn(`[MasterEditLog] Failed to log edit: ${error.message}`);
      }
    },

    /**
     * Get last editor for a document
     */
    async getLastEditor(contentType: string, documentId: string): Promise<{
      editedBy: string;
      editedAt: Date;
      operation: string;
    } | null> {
      if (!await this.ensureEditLogTable()) {
        return null;
      }

      try {
        const db = strapi.db.connection;
        const entry = await db('master_edit_log')
          .where({ content_type: contentType, document_id: documentId })
          .first();

        if (!entry) return null;

        return {
          editedBy: entry.edited_by,
          editedAt: new Date(entry.edited_at),
          operation: entry.operation,
        };
      } catch (error: any) {
        return null;
      }
    },

    /**
     * Check if document was edited by Master admin (not by ship sync)
     */
    async wasEditedByMaster(contentType: string, documentId: string, afterTimestamp?: Date): Promise<boolean> {
      const lastEdit = await this.getLastEditor(contentType, documentId);
      
      if (!lastEdit) return false;
      if (lastEdit.editedBy !== 'master-admin') return false;
      
      // If timestamp provided, check if edit was after that time
      if (afterTimestamp && lastEdit.editedAt <= afterTimestamp) {
        return false;
      }
      
      return true;
    },

    /**
     * Delete edit log entry (when document is deleted)
     */
    async deleteEditLog(contentType: string, documentId: string): Promise<void> {
      if (!await this.ensureEditLogTable()) {
        return;
      }

      try {
        const db = strapi.db.connection;
        await db('master_edit_log')
          .where({ content_type: contentType, document_id: documentId })
          .delete();
      } catch (error: any) {
        strapi.log.warn(`[MasterEditLog] Failed to delete: ${error.message}`);
      }
    },
  };
};

