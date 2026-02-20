/**
 * Initial Sync Controller
 * API endpoints to trigger initial sync for production data migration
 */
declare const strapi: any;

export default {
  /**
   * Pull all content from master and create mappings
   * POST /offline-sync/initial-sync/pull
   * Body: { masterUrl: string, masterApiToken?: string, contentTypes?: string[], dryRun?: boolean }
   */
  async pull(ctx: any) {
    const { masterUrl, masterApiToken, contentTypes, dryRun } = ctx.request.body;

    if (!masterUrl) {
      ctx.status = 400;
      ctx.body = { error: 'masterUrl is required' };
      return;
    }

    try {
      const initialSync = strapi.plugin('offline-sync').service('initial-sync');
      
      const result = await initialSync.pullFromMaster({
        masterUrl,
        masterApiToken,
        contentTypes,
        dryRun: dryRun === true,
      });

      ctx.body = result;
    } catch (error: any) {
      ctx.status = 500;
      ctx.body = { error: error.message };
    }
  },

  /**
   * Get initial sync status and instructions
   * GET /offline-sync/initial-sync/status
   */
  async status(ctx: any) {
    const config = strapi.config.get('plugin::offline-sync', {});
    const initialSync = strapi.plugin('offline-sync').service('initial-sync');

    const discoveredTypes = initialSync.discoverApiContentTypes() as string[];
    const configuredTypes = (config.contentTypes || []) as string[];
    const typesToSync = configuredTypes.length > 0 ? configuredTypes : discoveredTypes;

    const contentTypeSummary: Array<{ uid: string; kind: string; entries: number }> = [];
    let totalEntries = 0;

    for (const uid of typesToSync) {
      try {
        const model = strapi.contentTypes[uid];
        const kind: string = model?.kind || 'unknown';
        if (kind === 'singleType') continue;

        const count: number = await strapi.documents(uid as any).count({});
        contentTypeSummary.push({ uid, kind, entries: count });
        totalEntries += count;
      } catch {
        contentTypeSummary.push({ uid, kind: 'error', entries: 0 });
      }
    }

    ctx.body = {
      mode: config.mode,
      shipId: config.shipId,
      totalContentTypes: contentTypeSummary.length,
      totalEntries,
      contentTypes: contentTypeSummary,
      instructions: config.mode === 'replica'
        ? [
            '1. Make sure master Strapi is running and accessible',
            '2. Create an API token on master with read access to content types',
            '3. POST to /offline-sync/initial-sync/pull with:',
            '   { "masterUrl": "http://master-ip:1337", "masterApiToken": "your-token", "dryRun": true }',
            '4. Review the dry run results',
            '5. Run again with "dryRun": false to actually sync',
          ]
        : ['Initial sync is only available in replica mode'],
    };
  },
};

