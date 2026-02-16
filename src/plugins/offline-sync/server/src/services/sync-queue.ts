export default ({ strapi }: { strapi: any }) => {
  let tableExists: boolean | null = null;

  const parseJsonField = (value: any): any => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  };

  return {
    /**
     * Check if sync_queue table exists (cached)
     */
    async ensureTable(): Promise<boolean> {
      if (tableExists !== null) return tableExists;
      
      const db = strapi.db.connection;
      tableExists = await db.schema.hasTable('sync_queue');
      return tableExists;
    },

    /**
     * Enqueue an operation for sync
     */
    async enqueue(operation: {
      shipId: string;
      contentType: string;
      contentId: string | number;
      operation: 'create' | 'update' | 'delete';
      localVersion: number;
      data: any;
      locale?: string | null; // For i18n support
    }): Promise<any> {
      if (!await this.ensureTable()) {
        strapi.log.warn('sync_queue table does not exist');
        return null;
      }

      const db = strapi.db.connection;
      
      // Build insert data - include locale only if provided
      const insertData: any = {
        ship_id: operation.shipId,
        content_type: operation.contentType,
        content_id: String(operation.contentId),
        operation: operation.operation,
        local_version: operation.localVersion,
        data: JSON.stringify(operation.data),
        status: 'pending',
        created_at: new Date(),
      };
      
      // Include locale in data JSON for i18n support
      if (operation.locale) {
        insertData.data = JSON.stringify({
          ...operation.data,
          _syncLocale: operation.locale, // Store locale in data
        });
      }
      
      const [result] = await db('sync_queue')
        .insert(insertData)
        .returning('*');

      return result;
    },

    /**
     * Dequeue pending operations
     */
    async dequeue(shipId: string, limit: number = 100): Promise<any[]> {
      if (!await this.ensureTable()) {
        return [];
      }

      const db = strapi.db.connection;
      const entries = await db('sync_queue')
        .where({ ship_id: shipId, status: 'pending' })
        .orderBy('created_at', 'asc')
        .limit(limit);

      if (entries.length > 0) {
        await db('sync_queue')
          .whereIn('id', entries.map((e: any) => e.id))
          .update({ status: 'syncing' });
      }

      return entries.map((entry: any) => {
        const parsedData = parseJsonField(entry.data);
        
        // Extract locale from data if stored there
        let locale = null;
        if (parsedData && parsedData._syncLocale) {
          locale = parsedData._syncLocale;
          delete parsedData._syncLocale; // Remove from data
        }
        
        return {
          ...entry,
          data: parsedData,
          locale, // Add locale as separate field
        };
      });
    },

    /**
     * Mark operation as pushed (sent to Kafka, awaiting Master)
     */
    async markPushed(queueId: number, kafkaOffset?: number): Promise<void> {
      const db = strapi.db.connection;
      await db('sync_queue')
        .where({ id: queueId })
        .update({
          status: 'pushed',
          synced_at: new Date(),
          kafka_offset: kafkaOffset || null,
        });
    },

    /**
     * Mark operation as synced (Master confirmed)
     */
    async markSynced(queueId: number): Promise<void> {
      const db = strapi.db.connection;
      await db('sync_queue')
        .where({ id: queueId })
        .update({ status: 'synced' });
    },

    /**
     * Mark operation as failed
     */
    async markFailed(queueId: number, error: Error): Promise<void> {
      const db = strapi.db.connection;
      const entry = await db('sync_queue').where({ id: queueId }).first();

      await db('sync_queue')
        .where({ id: queueId })
        .update({
          status: 'failed',
          error_message: error.message,
          retry_count: (entry?.retry_count || 0) + 1,
        });
    },

    /**
     * Mark operation as conflict pending (Master detected conflict, awaiting resolution)
     */
    async markConflictPending(options: {
      contentType: string;
      contentId: string;
      shipId: string;
      conflictId: number;
      reason: string;
    }): Promise<void> {
      if (!await this.ensureTable()) {
        return;
      }

      const db = strapi.db.connection;
      
      // Find the queue entry for this content
      const entry = await db('sync_queue')
        .where({
          ship_id: options.shipId,
          content_type: options.contentType,
          content_id: String(options.contentId),
        })
        .whereIn('status', ['pending', 'syncing', 'pushed'])
        .orderBy('created_at', 'desc')
        .first();

      if (entry) {
        await db('sync_queue')
          .where({ id: entry.id })
          .update({
            status: 'conflict_pending',
            conflict_id: options.conflictId,
            conflict_reason: options.reason,
            error_message: `Conflict #${options.conflictId}: ${options.reason}`,
            updated_at: new Date(),
          });
        
        strapi.log.info(`[SyncQueue] Marked entry ${entry.id} as conflict_pending (conflict #${options.conflictId})`);
      } else {
        strapi.log.debug(`[SyncQueue] No pending entry found for ${options.contentType}/${options.contentId}`);
      }
    },

    /**
     * Mark operation as conflict rejected (Master kept its version, ship changes discarded)
     */
    async markConflictRejected(options: {
      contentType: string;
      contentId: string;
      shipId: string;
      conflictId: number;
      reason?: string;
    }): Promise<void> {
      if (!await this.ensureTable()) {
        return;
      }

      const db = strapi.db.connection;
      
      await db('sync_queue')
        .where({
          ship_id: options.shipId,
          content_type: options.contentType,
          content_id: String(options.contentId),
        })
        .whereIn('status', ['conflict_pending', 'conflict'])
        .update({
          status: 'conflict_rejected',
          conflict_resolution: 'keep-master',
          conflict_resolved_at: new Date(),
          error_message: options.reason || 'Master version kept, ship changes discarded',
          updated_at: new Date(),
        });
      
      strapi.log.info(`[SyncQueue] Marked conflict #${options.conflictId} as rejected for ${options.contentType}/${options.contentId}`);
    },

    /**
     * Mark operation as conflict accepted (Ship version applied to master)
     */
    async markConflictAccepted(options: {
      contentType: string;
      contentId: string;
      shipId: string;
      conflictId: number;
    }): Promise<void> {
      if (!await this.ensureTable()) {
        return;
      }

      const db = strapi.db.connection;
      
      await db('sync_queue')
        .where({
          ship_id: options.shipId,
          content_type: options.contentType,
          content_id: String(options.contentId),
        })
        .whereIn('status', ['conflict_pending', 'conflict'])
        .update({
          status: 'conflict_accepted',
          conflict_resolution: 'keep-ship',
          conflict_resolved_at: new Date(),
          error_message: 'Ship version accepted and applied to master',
          updated_at: new Date(),
        });
      
      strapi.log.info(`[SyncQueue] Marked conflict #${options.conflictId} as accepted for ${options.contentType}/${options.contentId}`);
    },

    /**
     * Mark operation as conflict merged (Partial merge applied)
     */
    async markConflictMerged(options: {
      contentType: string;
      contentId: string;
      shipId: string;
      conflictId: number;
      mergeDetails?: string;
    }): Promise<void> {
      if (!await this.ensureTable()) {
        return;
      }

      const db = strapi.db.connection;
      
      await db('sync_queue')
        .where({
          ship_id: options.shipId,
          content_type: options.contentType,
          content_id: String(options.contentId),
        })
        .whereIn('status', ['conflict_pending', 'conflict'])
        .update({
          status: 'conflict_merged',
          conflict_resolution: 'merge',
          conflict_resolved_at: new Date(),
          error_message: options.mergeDetails || 'Changes were merged',
          updated_at: new Date(),
        });
      
      strapi.log.info(`[SyncQueue] Marked conflict #${options.conflictId} as merged for ${options.contentType}/${options.contentId}`);
    },

    /**
     * Legacy method for backward compatibility
     */
    async markConflict(options: {
      contentType: string;
      contentId: string;
      shipId: string;
      conflictId: number;
      reason: string;
    }): Promise<void> {
      // Use the new conflict_pending status
      return this.markConflictPending(options);
    },

    /**
     * Get conflict entries (all conflict-related statuses)
     */
    async getConflicts(shipId: string): Promise<any[]> {
      if (!await this.ensureTable()) {
        return [];
      }

      const db = strapi.db.connection;
      const entries = await db('sync_queue')
        .where({ ship_id: shipId })
        .where(function() {
          this.where('status', 'like', 'conflict%')
            .orWhere('status', 'conflict');
        })
        .orderBy('created_at', 'desc')
        .limit(100);

      return entries.map((entry: any) => ({
        ...entry,
        data: parseJsonField(entry.data),
      }));
    },

    /**
     * Get pending conflicts (not yet resolved)
     */
    async getPendingConflicts(shipId: string): Promise<any[]> {
      if (!await this.ensureTable()) {
        return [];
      }

      const db = strapi.db.connection;
      const entries = await db('sync_queue')
        .where({ ship_id: shipId, status: 'conflict_pending' })
        .orderBy('created_at', 'desc')
        .limit(100);

      return entries.map((entry: any) => ({
        ...entry,
        data: parseJsonField(entry.data),
      }));
    },

    /**
     * Get sync queue statistics with conflict breakdown
     */
    async getStats(shipId: string): Promise<{
      pending: number;
      syncing: number;
      synced: number;
      failed: number;
      conflict_pending: number;
      conflict_rejected: number;
      conflict_accepted: number;
      conflict_merged: number;
      total: number;
    }> {
      if (!await this.ensureTable()) {
        return {
          pending: 0, syncing: 0, synced: 0, failed: 0,
          conflict_pending: 0, conflict_rejected: 0, conflict_accepted: 0, conflict_merged: 0,
          total: 0
        };
      }

      const db = strapi.db.connection;
      const results = await db('sync_queue')
        .where({ ship_id: shipId })
        .select('status')
        .count('* as count')
        .groupBy('status');

      const stats: any = {
        pending: 0, syncing: 0, synced: 0, failed: 0,
        conflict_pending: 0, conflict_rejected: 0, conflict_accepted: 0, conflict_merged: 0,
        total: 0
      };

      for (const row of results) {
        const status = row.status as string;
        const count = parseInt(row.count as string) || 0;
        stats[status] = count;
        stats.total += count;
      }

      return stats;
    },

    /**
     * Get pending operations count
     */
    async getPending(shipId: string): Promise<number> {
      if (!await this.ensureTable()) {
        return 0;
      }

      const db = strapi.db.connection;
      const [result] = await db('sync_queue')
        .where({ ship_id: shipId, status: 'pending' })
        .count('* as count');

      return parseInt(result.count as string) || 0;
    },

    /**
     * Get queue entries
     */
    async getQueue(shipId: string): Promise<any[]> {
      if (!await this.ensureTable()) {
        return [];
      }

      const db = strapi.db.connection;
      const entries = await db('sync_queue')
        .where({ ship_id: shipId })
        .orderBy('created_at', 'desc')
        .limit(100);

      return entries.map((entry: any) => ({
        ...entry,
        data: parseJsonField(entry.data),
      }));
    },
  };
};

