export default ({ strapi }: { strapi: any }) => {
  let tableExists: boolean | null = null;

  return {
    /**
     * Check if content_versions table exists (cached)
     */
    async ensureTable(): Promise<boolean> {
      if (tableExists !== null) return tableExists;
      
      const db = strapi.db.connection;
      tableExists = await db.schema.hasTable('content_versions');
      return tableExists;
    },

    /**
     * Get current version for content
     */
    async getVersion(contentType: string, contentId: string | number): Promise<number> {
      if (!await this.ensureTable()) {
        return 1;
      }

      const db = strapi.db.connection;
      const result = await db('content_versions')
        .where({ content_type: contentType, content_id: String(contentId) })
        .orderBy('version', 'desc')
        .first();

      return result?.version ?? 1;
    },

    /**
     * Increment version for content
     */
    async incrementVersion(
      contentType: string,
      contentId: string | number,
      shipId?: string
    ): Promise<number> {
      if (!await this.ensureTable()) {
        return 1;
      }

      const db = strapi.db.connection;
      const currentVersion = await this.getVersion(contentType, contentId);
      const newVersion = currentVersion + 1;

      await db('content_versions').insert({
        content_type: contentType,
        content_id: String(contentId),
        version: newVersion,
        ship_id: shipId || null,
        changed_at: new Date(),
      });

      return newVersion;
    },

    /**
     * Create version snapshot
     */
    async createSnapshot(
      contentType: string,
      contentId: string | number,
      version: number,
      data: any,
      shipId?: string
    ): Promise<void> {
      if (!await this.ensureTable()) {
        return;
      }

      const db = strapi.db.connection;
      await db('content_versions')
        .where({ content_type: contentType, content_id: String(contentId), version })
        .update({
          data_snapshot: JSON.stringify(data),
          ship_id: shipId || null,
        });
    },

    /**
     * Compare versions
     */
    compareVersions(local: number, remote: number): {
      isConflict: boolean;
      isLocalNewer: boolean;
      isRemoteNewer: boolean;
    } {
      return {
        isConflict: local !== remote,
        isLocalNewer: local > remote,
        isRemoteNewer: remote > local,
      };
    },
  };
};

