import NodeCache from 'node-cache';

/**
 * Response Cache Middleware for Strapi v5
 * 
 * Caches API responses in-memory to reduce database load from populate=* queries
 * 
 * Features:
 * - Caches GET requests only
 * - Respects cache headers if present
 * - Automatic cache invalidation on content updates
 * - Configurable TTL and cache key generation
 */

// Define the structure of cached responses
interface CachedResponse {
  status: number;
  body: any;
}

// Initialize cache with configuration
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL || '3600', 10), // Default: 1 hour
  checkperiod: parseInt(process.env.CACHE_CHECK_PERIOD || '60', 10), // Cleanup interval
  useClones: false, // Better performance, use original objects
  deleteOnExpire: true,
  maxKeys: parseInt(process.env.CACHE_MAX_KEYS || '1000', 10), // Max cached entries
});

// Track cache statistics
let cacheStats = {
  hits: 0,
  misses: 0,
  size: 0,
};

// Log cache stats periodically (every 5 minutes)
setInterval(() => {
  cacheStats.size = cache.keys().length;
  if (process.env.NODE_ENV !== 'production' || process.env.CACHE_DEBUG === 'true') {
    console.log('[Cache Stats]', {
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: cacheStats.hits + cacheStats.misses > 0
        ? `${((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100).toFixed(2)}%`
        : '0%',
      size: cacheStats.size,
      maxKeys: cache.options.maxKeys,
    });
  }
}, 300000);

/**
 * Generate a unique cache key from request
 */
function generateCacheKey(ctx): string {
  const { method, path, querystring } = ctx.request;
  return `${method}:${path}${querystring ? '?' + querystring : ''}`;
}

/**
 * Check if request should be cached
 */
function shouldCache(ctx): boolean {
  const { method, path } = ctx.request;

  // Only cache GET requests
  if (method !== 'GET') {
    return false;
  }

  // Don't cache admin routes
  if (path.startsWith('/admin')) {
    return false;
  }

  // Don't cache offline-sync plugin routes
  if (path.startsWith('/api/offline-sync')) {
    return false;
  }

  // Optionally respect Cache-Control: no-cache header (disabled by default for maximum caching)
  // Enable by setting CACHE_RESPECT_NO_CACHE=true in environment
  if (process.env.CACHE_RESPECT_NO_CACHE === 'true') {
    if (ctx.request.headers['cache-control']?.includes('no-cache')) {
      return false;
    }
  }

  // Cache API routes (this is where populate=* happens)
  if (path.startsWith('/api/')) {
    return true;
  }

  return false;
}

/**
 * Clear cache for specific content type
 */
function clearCacheForContentType(contentType: string) {
  const keys = cache.keys();
  let clearedCount = 0;

  // Clear all cache entries that might be related to this content type
  keys.forEach((key) => {
    if (key.includes(`/api/${contentType}`)) {
      cache.del(key);
      clearedCount++;
    }
  });

  if (clearedCount > 0 && process.env.NODE_ENV !== 'production') {
    console.log(`[Cache] Cleared ${clearedCount} entries for content-type: ${contentType}`);
  }
}

/**
 * Response Cache Middleware
 */
export default (config, { strapi }) => {
  return async (ctx, next) => {
    // Skip if caching is disabled
    if (process.env.CACHE_ENABLED === 'false') {
      return await next();
    }

    // Check if this request should be cached
    if (!shouldCache(ctx)) {
      return await next();
    }

    const cacheKey = generateCacheKey(ctx);

    // Try to get from cache
    const cachedResponse = cache.get<CachedResponse>(cacheKey);

    if (cachedResponse) {
      // Cache hit!
      cacheStats.hits++;

      if (process.env.NODE_ENV !== 'production' || process.env.CACHE_DEBUG === 'true') {
        console.log(`[Cache HIT] ${cacheKey}`);
      }

      // Set cache headers
      ctx.set('X-Cache', 'HIT');
      ctx.set('X-Cache-Key', cacheKey);

      // Return cached response
      ctx.status = cachedResponse.status;
      ctx.body = cachedResponse.body;

      return;
    }

    // Cache miss - proceed with request
    cacheStats.misses++;

    if (process.env.NODE_ENV !== 'production' || process.env.CACHE_DEBUG === 'true') {
      console.log(`[Cache MISS] ${cacheKey}`);
    }

    // Execute the request
    await next();

    // Cache the response if it was successful
    if (ctx.status === 200 && ctx.body) {
      const ttl = config?.ttl || parseInt(process.env.CACHE_TTL || '3600', 10);

      cache.set<CachedResponse>(cacheKey, {
        status: ctx.status,
        body: ctx.body,
      }, ttl);

      // Set cache headers
      ctx.set('X-Cache', 'MISS');
      ctx.set('X-Cache-Key', cacheKey);
      ctx.set('Cache-Control', `public, max-age=${ttl}`);
    }
  };
};

// Export utility functions for use in lifecycle hooks
export const clearCache = () => {
  const keyCount = cache.keys().length;
  cache.flushAll();
  console.log(`[Cache] Cleared all ${keyCount} entries`);
};

export const clearCachePattern = (pattern: string) => {
  const keys = cache.keys();
  let clearedCount = 0;

  keys.forEach((key) => {
    if (key.includes(pattern)) {
      cache.del(key);
      clearedCount++;
    }
  });

  console.log(`[Cache] Cleared ${clearedCount} entries matching pattern: ${pattern}`);
};

export { clearCacheForContentType };
