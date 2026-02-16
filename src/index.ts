import type { Core } from '@strapi/strapi';
import { clearCache, clearCachePattern } from './middlewares/response-cache';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) { },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Check if cache invalidation should clear ALL cache or just related content
    // Default: true (clears all cache) - best for populate=* scenarios where relations matter
    // Set CACHE_CLEAR_ALL_ON_UPDATE=false to only clear specific content type cache
    const clearAllOnUpdate = process.env.CACHE_CLEAR_ALL_ON_UPDATE !== 'false';

    // Content types to IGNORE (internal Strapi tables, not API content)
    const ignoredContentTypes = [
      'session',
      'token',
      'api-token',
      'api-token-permission',
      'permission',
      'role',
      'user',           // Admin users
      'transfer-token',
      'transfer-token-permission',
      'release',
      'release-action',
      'workflow',
      'workflow-stage',
      'file',           // Media uploads (handled separately)
      'folder',
    ];

    // Check if content type should trigger cache invalidation
    const shouldInvalidateCache = (uid: string, singularName: string): boolean => {
      // Only invalidate for API content types (api::*)
      if (!uid.startsWith('api::')) {
        return false;
      }
      // Check against ignored list
      if (ignoredContentTypes.includes(singularName)) {
        return false;
      }
      return true;
    };

    // Helper function to invalidate cache based on configuration
    const invalidateCache = (action: string, uid: string, contentType: string) => {
      // Skip internal Strapi content types
      if (!shouldInvalidateCache(uid, contentType)) {
        return;
      }

      if (clearAllOnUpdate) {
        console.log(`[Cache] ${action} in ${contentType}, clearing ALL cache (populate=* mode)...`);
        clearCache();
      } else {
        console.log(`[Cache] ${action} in ${contentType}, clearing related cache...`);
        clearCachePattern(`/api/${contentType}`);
      }
    };

    // Subscribe to all content-type lifecycle events for cache invalidation
    strapi.db.lifecycles.subscribe({
      // Clear cache after any content is created
      afterCreate(event) {
        invalidateCache('Content created', event.model.uid, event.model.singularName);
      },

      // Clear cache after any content is updated
      afterUpdate(event) {
        invalidateCache('Content updated', event.model.uid, event.model.singularName);
      },

      // Clear cache after any content is deleted
      afterDelete(event) {
        invalidateCache('Content deleted', event.model.uid, event.model.singularName);
      },

      // Clear cache after bulk operations
      afterDeleteMany(event) {
        invalidateCache('Bulk delete', event.model.uid, event.model.singularName);
      },

      afterUpdateMany(event) {
        invalidateCache('Bulk update', event.model.uid, event.model.singularName);
      },

      afterCreateMany(event) {
        invalidateCache('Bulk create', event.model.uid, event.model.singularName);
      },
    });

    console.log(`[Cache] Auto-invalidation lifecycle hooks registered (clearAll: ${clearAllOnUpdate})`);

    // Video compression is handled by middleware (see config/middlewares.ts)
    console.log('[Video] Compression middleware registered (see config/middlewares.ts)');
  },
};
