/**
 * Media Sync Service
 * 
 * Handles media synchronization between master (OSS) and replica (MinIO).
 * Uses the minio npm package to:
 * - Sync files from OSS to local MinIO when online
 * - Transform media URLs in content during sync
 * - Track sync status and handle offline scenarios
 */

import { Client as MinioClient } from 'minio';

interface MediaConfig {
  enabled: boolean;
  transformUrls: boolean;
  syncOnStartup: boolean;
  syncInterval: number;
  maxFilesPerSync?: number; // Limit files per sync run (for large buckets, 0 = unlimited)
  disableFullSync?: boolean; // If true, only use on-demand sync (no periodic full sync)
  oss: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    baseUrl: string;
    region?: string;
    uploadPath?: string;  // Path prefix for uploads (e.g., 'strapi-uploads')
    pathStyle?: boolean;  // Use path-style URLs (false for Alibaba OSS)
  };
  minio: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    baseUrl: string;
  };
  mediaFields: string[];
}

interface SyncStats {
  lastSyncAt: Date | null;
  filesDownloaded: number;
  filesSkipped: number;
  filesFailed: number;
  totalBytes: number;
  isRunning: boolean;
  error: string | null;
}

export default ({ strapi }: { strapi: any }) => {
  let ossClient: MinioClient | null = null;
  let minioClient: MinioClient | null = null;
  let syncIntervalId: NodeJS.Timeout | null = null;
  let isSyncing = false;

  const syncStats: SyncStats = {
    lastSyncAt: null,
    filesDownloaded: 0,
    filesSkipped: 0,
    filesFailed: 0,
    totalBytes: 0,
    isRunning: false,
    error: null,
  };

  /**
   * Escape special regex characters in a string
   */
  const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  /**
   * Get media configuration from plugin config
   */
  const getMediaConfig = (): MediaConfig | null => {
    const config = strapi.config.get('plugin::offline-sync', {});

    if (!config.media?.enabled) {
      return null;
    }

    return {
      enabled: config.media.enabled,
      transformUrls: config.media.transformUrls !== false,
      syncOnStartup: config.media.syncOnStartup !== false,
      syncInterval: config.media.syncInterval || 300000, // 5 minutes default
      maxFilesPerSync: config.media.maxFilesPerSync || 0, // 0 = unlimited
      disableFullSync: config.media.disableFullSync === true, // Default: false (allow full sync)
      oss: {
        endPoint: config.media.oss?.endPoint || '',
        port: config.media.oss?.port || 443,
        useSSL: config.media.oss?.useSSL !== false,
        accessKey: config.media.oss?.accessKey || '',
        secretKey: config.media.oss?.secretKey || '',
        bucket: config.media.oss?.bucket || '',
        baseUrl: config.media.oss?.baseUrl || '',
        region: config.media.oss?.region || '',
        uploadPath: config.media.oss?.uploadPath || '',  // Path prefix (e.g., 'strapi-uploads')
        pathStyle: config.media.oss?.pathStyle === true,  // Default false for Alibaba OSS
      },
      minio: {
        endPoint: config.media.minio?.endPoint || 'localhost',
        port: config.media.minio?.port || 9000,
        useSSL: config.media.minio?.useSSL || false,
        accessKey: config.media.minio?.accessKey || 'minioadmin',
        secretKey: config.media.minio?.secretKey || 'minioadmin',
        bucket: config.media.minio?.bucket || 'media',
        baseUrl: config.media.minio?.baseUrl || 'http://localhost:9000/media',
      },
      mediaFields: config.media.mediaFields || [
        'url', 'src', 'href', 'image', 'thumbnail', 'video', 'file',
        'formats', 'previewUrl', 'provider_metadata',
      ],
    };
  };

  /**
   * Initialize MinIO clients
   */
  const initClients = async (): Promise<boolean> => {
    const config = getMediaConfig();
    if (!config) {
      return false;
    }

    try {
      // Initialize OSS client (Alibaba OSS is S3-compatible)
      if (config.oss.endPoint && config.oss.accessKey) {
        const ossEndpoint = config.oss.endPoint.replace(/^https?:\/\//, '');

        // For Alibaba OSS, region should match endpoint (e.g., oss-cn-hangzhou)
        const ossRegion = config.oss.region || ossEndpoint.split('.')[0] || 'oss-cn-hangzhou';

        ossClient = new MinioClient({
          endPoint: ossEndpoint,
          port: config.oss.port,
          useSSL: config.oss.useSSL,
          accessKey: config.oss.accessKey,
          secretKey: config.oss.secretKey,
          region: ossRegion,
          pathStyle: config.oss.pathStyle,  // false for Alibaba OSS (virtual-hosted style)
        });

        strapi.log.info(`[MediaSync] OSS client initialized`);
        strapi.log.info(`[MediaSync]   Endpoint: ${ossEndpoint}`);
        strapi.log.info(`[MediaSync]   Bucket: ${config.oss.bucket}`);
        strapi.log.info(`[MediaSync]   Region: ${ossRegion}`);
        strapi.log.info(`[MediaSync]   Upload Path: ${config.oss.uploadPath || '(root)'}`);
      } else {
        strapi.log.warn('[MediaSync] OSS client not initialized - missing endpoint or accessKey');
      }

      // Initialize local MinIO client
      strapi.log.info(`[MediaSync] Checking MinIO configuration...`);
      strapi.log.info(`[MediaSync]   endPoint: ${config.minio.endPoint || 'MISSING'}`);
      strapi.log.info(`[MediaSync]   port: ${config.minio.port || 'MISSING'}`);
      strapi.log.info(`[MediaSync]   accessKey: ${config.minio.accessKey ? 'SET' : 'MISSING'}`);
      strapi.log.info(`[MediaSync]   secretKey: ${config.minio.secretKey ? 'SET' : 'MISSING'}`);
      strapi.log.info(`[MediaSync]   bucket: ${config.minio.bucket || 'MISSING'}`);
      strapi.log.info(`[MediaSync]   baseUrl: ${config.minio.baseUrl || 'MISSING'}`);
      
      if (config.minio.endPoint && config.minio.accessKey) {
        try {
          const minioEndpoint = config.minio.endPoint.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
          strapi.log.info(`[MediaSync] Creating MinIO client with endpoint: ${minioEndpoint}:${config.minio.port}`);
          
          minioClient = new MinioClient({
            endPoint: minioEndpoint,
            port: config.minio.port,
            useSSL: config.minio.useSSL || false,
            accessKey: config.minio.accessKey,
            secretKey: config.minio.secretKey,
          });
          
          strapi.log.info(`[MediaSync] ✅ MinIO client created successfully`);
          
          // Test connection by checking if bucket exists
          try {
            const bucketExists = await minioClient.bucketExists(config.minio.bucket);
            if (bucketExists) {
              strapi.log.info(`[MediaSync] ✅ MinIO bucket '${config.minio.bucket}' exists`);
            } else {
              strapi.log.warn(`[MediaSync] ⚠️ MinIO bucket '${config.minio.bucket}' does not exist - will be created on first use`);
            }
          } catch (bucketError: any) {
            strapi.log.error(`[MediaSync] ❌ Failed to check MinIO bucket: ${bucketError.message}`);
            strapi.log.error(`[MediaSync] Make sure MinIO is running at ${minioEndpoint}:${config.minio.port}`);
          }
          
          strapi.log.info(`[MediaSync]   Endpoint: ${minioEndpoint}:${config.minio.port}`);
          strapi.log.info(`[MediaSync]   Bucket: ${config.minio.bucket}`);
          strapi.log.info(`[MediaSync]   Base URL: ${config.minio.baseUrl}`);
        } catch (minioError: any) {
          strapi.log.error(`[MediaSync] ❌ Failed to create MinIO client: ${minioError.message}`);
          strapi.log.error(`[MediaSync] Error stack: ${minioError.stack}`);
        }
      } else {
        strapi.log.error(`[MediaSync] ❌ MinIO client not initialized - missing required config`);
        strapi.log.error(`[MediaSync]   endPoint: ${config.minio.endPoint || 'MISSING'}`);
        strapi.log.error(`[MediaSync]   accessKey: ${config.minio.accessKey ? 'SET' : 'MISSING'}`);
        strapi.log.error(`[MediaSync]   port: ${config.minio.port || 'MISSING'}`);
      }

      return true;
    } catch (error: any) {
      strapi.log.error(`[MediaSync] Failed to initialize clients: ${error.message}`);
      return false;
    }
  };

  /**
   * Ensure MinIO bucket exists
   */
  const ensureBucket = async (): Promise<boolean> => {
    const config = getMediaConfig();
    if (!config || !minioClient) {
      return false;
    }

    try {
      const exists = await minioClient.bucketExists(config.minio.bucket);
      if (!exists) {
        await minioClient.makeBucket(config.minio.bucket);
        strapi.log.info(`[MediaSync] Created MinIO bucket: ${config.minio.bucket}`);
      }
      return true;
    } catch (error: any) {
      strapi.log.error(`[MediaSync] Failed to ensure bucket: ${error.message}`);
      return false;
    }
  };

  /**
   * Check if file exists in MinIO
   */
  const fileExistsInMinio = async (objectName: string): Promise<boolean> => {
    const config = getMediaConfig();
    if (!config || !minioClient) {
      return false;
    }

    try {
      await minioClient.statObject(config.minio.bucket, objectName);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Sync a single file from OSS to MinIO
   */
  const syncFile = async (objectName: string): Promise<boolean> => {
    const config = getMediaConfig();
    if (!config || !ossClient || !minioClient) {
      return false;
    }

    try {
      // Get file from OSS
      const dataStream = await ossClient.getObject(config.oss.bucket, objectName);

      // Get file stats for size
      const stat = await ossClient.statObject(config.oss.bucket, objectName);

      // Upload to MinIO
      await minioClient.putObject(
        config.minio.bucket,
        objectName,
        dataStream,
        stat.size,
        { 'Content-Type': stat.metaData?.['content-type'] || 'application/octet-stream' }
      );

      syncStats.filesDownloaded++;
      syncStats.totalBytes += stat.size;

      return true;
    } catch (error: any) {
      strapi.log.debug(`[MediaSync] Failed to sync file ${objectName}: ${error.message}`);
      syncStats.filesFailed++;
      return false;
    }
  };

  /**
   * Sync all files from OSS to MinIO
   * Production-optimized: Parallel processing with batching for large file counts
   */
  const syncAllFiles = async (): Promise<void> => {
    const config = getMediaConfig();
    if (!config || !ossClient || !minioClient) {
      strapi.log.warn('[MediaSync] Cannot sync - clients not initialized');
      return;
    }

    if (isSyncing) {
      strapi.log.debug('[MediaSync] Sync already in progress, skipping');
      return;
    }

    isSyncing = true;
    syncStats.isRunning = true;
    syncStats.error = null;

    const startTime = Date.now();
    let processed = 0;
    let listed = 0;
    const BATCH_SIZE = 20; // Process 20 files in parallel
    const CONCURRENT_BATCHES = 5; // 5 batches = 100 files concurrently

    try {
      strapi.log.info('[MediaSync] Starting media sync from OSS to MinIO...');

      // Ensure MinIO bucket exists
      await ensureBucket();

      // Use uploadPath as prefix when listing (e.g., 'strapi-uploads/')
      const prefix = config.oss.uploadPath
        ? (config.oss.uploadPath.endsWith('/') ? config.oss.uploadPath : config.oss.uploadPath + '/')
        : '';

      strapi.log.info(`[MediaSync] Listing files from OSS bucket: ${config.oss.bucket}`);
      strapi.log.info(`[MediaSync] Using prefix: "${prefix || '(root)'}"`);

      // First, try to verify OSS connection
      try {
        const bucketExists = await ossClient.bucketExists(config.oss.bucket);
        if (!bucketExists) {
          strapi.log.error(`[MediaSync] OSS bucket "${config.oss.bucket}" does not exist or is not accessible`);
          syncStats.error = `Bucket "${config.oss.bucket}" not found`;
          return;
        }
        strapi.log.info(`[MediaSync] ✅ OSS bucket "${config.oss.bucket}" is accessible`);
      } catch (bucketError: any) {
        strapi.log.error(`[MediaSync] Failed to check OSS bucket: ${bucketError.message}`);
        syncStats.error = bucketError.message;
        return;
      }

      // Collect all file objects first (for batching)
      const allObjects: Array<{ name: string; size: number }> = [];
      const objectsStream = ossClient.listObjects(config.oss.bucket, prefix, true);

      strapi.log.info('[MediaSync] Collecting file list from OSS...');
      for await (const obj of objectsStream) {
        if (obj.name) {
          allObjects.push({ name: obj.name, size: obj.size || 0 });
        }
      }

      listed = allObjects.length;
      
      // Apply maxFilesPerSync limit if configured (for large buckets)
      const filesToProcess = config.maxFilesPerSync && config.maxFilesPerSync > 0
        ? Math.min(listed, config.maxFilesPerSync)
        : listed;

      if (filesToProcess < listed) {
        strapi.log.info(`[MediaSync] Limiting sync to ${filesToProcess} files (${listed} total available)`);
      }

      strapi.log.info(`[MediaSync] Found ${listed} files to check. Processing ${filesToProcess} files in batches of ${BATCH_SIZE} (${CONCURRENT_BATCHES} concurrent batches)...`);

      if (listed === 0) {
        strapi.log.warn(`[MediaSync] ⚠️ No files found in OSS bucket with prefix "${prefix}"`);
        strapi.log.warn(`[MediaSync] Check if uploadPath is correct in your config`);
        return;
      }

      // Limit files to process
      const objectsToProcess = filesToProcess < listed
        ? allObjects.slice(0, filesToProcess)
        : allObjects;

      // Process files in batches with parallel execution
      for (let i = 0; i < objectsToProcess.length; i += BATCH_SIZE * CONCURRENT_BATCHES) {
        // Process CONCURRENT_BATCHES batches at once
        const batchPromises: Promise<void>[] = [];

        for (let batchStart = i; batchStart < Math.min(i + BATCH_SIZE * CONCURRENT_BATCHES, objectsToProcess.length); batchStart += BATCH_SIZE) {
          const batch = objectsToProcess.slice(batchStart, batchStart + BATCH_SIZE);
          
          const batchPromise = (async () => {
            // Process batch items in parallel
            const filePromises = batch.map(async (obj) => {
              processed++;

              // Check if file already exists in MinIO
              const exists = await fileExistsInMinio(obj.name);
              if (exists) {
                syncStats.filesSkipped++;
                return;
              }

              // Sync file
              const success = await syncFile(obj.name);
              if (success && syncStats.filesDownloaded <= 10) {
                strapi.log.debug(`[MediaSync] ✅ Downloaded: ${obj.name}`);
              }
            });

            await Promise.all(filePromises);
          })();

          batchPromises.push(batchPromise);
        }

        // Wait for all batches in this group to complete
        await Promise.all(batchPromises);

        // Log progress every 100 files
        if (processed % 100 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const rate = processed > 0 ? (processed / ((Date.now() - startTime) / 1000)).toFixed(1) : '0';
          strapi.log.info(
            `[MediaSync] Progress: ${processed}/${filesToProcess} files processed ` +
            `(${syncStats.filesDownloaded} downloaded, ${syncStats.filesSkipped} skipped, ${syncStats.filesFailed} failed) ` +
            `[${rate} files/sec, ${elapsed}s elapsed]`
          );
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = processed > 0 ? (processed / parseFloat(duration)).toFixed(1) : '0';

      strapi.log.info(`[MediaSync] ✅ Sync completed in ${duration}s`);
      strapi.log.info(`[MediaSync]   Files listed: ${listed} (processed: ${filesToProcess})`);
      strapi.log.info(`[MediaSync]   Downloaded: ${syncStats.filesDownloaded}`);
      strapi.log.info(`[MediaSync]   Skipped (already exists): ${syncStats.filesSkipped}`);
      strapi.log.info(`[MediaSync]   Failed: ${syncStats.filesFailed}`);
      strapi.log.info(`[MediaSync]   Average rate: ${rate} files/sec`);
      
      if (filesToProcess < listed && config.maxFilesPerSync && config.maxFilesPerSync > 0) {
        strapi.log.info(`[MediaSync] ⚠️ Note: ${listed - filesToProcess} files not processed (maxFilesPerSync limit)`);
        strapi.log.info(`[MediaSync]   Remaining files will be synced on next run or via on-demand sync`);
      }

      syncStats.lastSyncAt = new Date();
    } catch (error: any) {
      strapi.log.error(`[MediaSync] Sync failed: ${error.message}`);
      strapi.log.error(`[MediaSync] Error details: ${error.stack || error}`);
      syncStats.error = error.message;
    } finally {
      isSyncing = false;
      syncStats.isRunning = false;
    }
  };

  /**
   * Transform URLs in content
   */
  const transformUrls = (
    data: any,
    fromBaseUrl: string,
    toBaseUrl: string,
    mediaFields: string[],
    depth: number = 0
  ): any => {
    if (depth > 20 || data === null || data === undefined) {
      return data;
    }

    // Handle strings
    if (typeof data === 'string') {
      if (data.includes(fromBaseUrl)) {
        return data.replace(new RegExp(escapeRegex(fromBaseUrl), 'g'), toBaseUrl);
      }
      return data;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      return data.map(item => transformUrls(item, fromBaseUrl, toBaseUrl, mediaFields, depth + 1));
    }

    // Handle objects
    if (typeof data === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = transformUrls(value, fromBaseUrl, toBaseUrl, mediaFields, depth + 1);
      }
      return result;
    }

    return data;
  };

  return {
    /**
     * Check if media sync is enabled
     */
    isEnabled(): boolean {
      const config = getMediaConfig();
      const enabled = config?.enabled === true;
      if (!enabled) {
        strapi.log.debug(`[MediaSync] Media sync disabled - config.enabled=${config?.enabled}, SYNC_MODE=${process.env.SYNC_MODE || 'not set'}`);
      }
      return enabled;
    },

    /**
     * Initialize media sync service
     */
    async initialize(): Promise<void> {
      const config = getMediaConfig();
      if (!config) {
        strapi.log.debug('[MediaSync] Media sync not enabled');
        return;
      }

      strapi.log.info('[MediaSync] Initializing media sync service...');

      // Initialize clients
      if (!(await initClients())) {
        strapi.log.warn('[MediaSync] Failed to initialize clients');
        return;
      }

      // Ensure bucket exists
      await ensureBucket();

      // Run initial sync if configured (skip if disabled for large buckets)
      if (config.syncOnStartup && !config.disableFullSync) {
        strapi.log.info('[MediaSync] Running initial sync...');
        // Run async to not block startup
        setImmediate(() => this.sync());
      } else if (config.disableFullSync) {
        strapi.log.info('[MediaSync] Full sync disabled - using on-demand sync only');
      }

      // Start periodic sync (skip if disabled for large buckets)
      if (config.syncInterval > 0 && !config.disableFullSync) {
        syncIntervalId = setInterval(() => {
          this.sync();
        }, config.syncInterval);
        strapi.log.info(`[MediaSync] Periodic sync enabled (interval: ${config.syncInterval / 1000}s)`);
      } else if (config.disableFullSync) {
        strapi.log.info('[MediaSync] Periodic sync disabled - using on-demand sync only');
      }
    },

    /**
     * Shutdown media sync service
     */
    async shutdown(): Promise<void> {
      if (syncIntervalId) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
      }
      strapi.log.info('[MediaSync] Service stopped');
    },

    /**
     * Trigger manual sync
     */
    async sync(): Promise<SyncStats> {
      // Reset counters for this sync
      syncStats.filesDownloaded = 0;
      syncStats.filesSkipped = 0;
      syncStats.filesFailed = 0;
      syncStats.totalBytes = 0;

      await syncAllFiles();
      return { ...syncStats };
    },

    /**
     * Get sync statistics
     */
    getStats(): SyncStats {
      return { ...syncStats };
    },

    /**
     * Transform media URLs from master (OSS) to replica (MinIO)
     */
    transformToReplica(data: any): any {
      const config = getMediaConfig();
      if (!config || !config.transformUrls) {
        return data;
      }

      if (!config.oss.baseUrl || !config.minio.baseUrl) {
        return data;
      }

      return transformUrls(
        data,
        config.oss.baseUrl,
        config.minio.baseUrl,
        config.mediaFields
      );
    },

    /**
     * Transform media URLs from replica (MinIO) to master (OSS)
     */
    transformToMaster(data: any): any {
      const config = getMediaConfig();
      if (!config || !config.transformUrls) {
        return data;
      }

      if (!config.oss.baseUrl || !config.minio.baseUrl) {
        return data;
      }

      return transformUrls(
        data,
        config.minio.baseUrl,
        config.oss.baseUrl,
        config.mediaFields
      );
    },

    /**
     * Check if MinIO is accessible
     */
    async isMinioHealthy(): Promise<boolean> {
      const config = getMediaConfig();
      if (!config || !minioClient) {
        return false;
      }

      try {
        await minioClient.bucketExists(config.minio.bucket);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Check if OSS is accessible
     */
    async isOssHealthy(): Promise<boolean> {
      const config = getMediaConfig();
      if (!config || !ossClient) {
        return false;
      }

      try {
        await ossClient.bucketExists(config.oss.bucket);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Get health status
     */
    async getHealth(): Promise<{
      minioConnected: boolean;
      ossConnected: boolean;
      lastSync: Date | null;
      isRunning: boolean;
    }> {
      return {
        minioConnected: await this.isMinioHealthy(),
        ossConnected: await this.isOssHealthy(),
        lastSync: syncStats.lastSyncAt,
        isRunning: syncStats.isRunning,
      };
    },

    /**
     * Sync a specific file by path
     */
    async syncFile(objectPath: string): Promise<boolean> {
      const config = getMediaConfig();
      if (!config || !ossClient || !minioClient) {
        return false;
      }

      return syncFile(objectPath);
    },

    /**
     * Get file URL from MinIO
     */
    getMinioUrl(objectPath: string): string {
      const config = getMediaConfig();
      if (!config) {
        return objectPath;
      }
      return `${config.minio.baseUrl}/${objectPath}`;
    },

    /**
     * Get file URL from OSS
     */
    getOssUrl(objectPath: string): string {
      const config = getMediaConfig();
      if (!config) {
        return objectPath;
      }
      return `${config.oss.baseUrl}/${objectPath}`;
    },

    /**
     * Extract all media URLs from content data
     * Recursively scans object for URLs matching OSS base URL
     */
    extractMediaUrls(data: any): string[] {
      const config = getMediaConfig();
      if (!config) {
        return [];
      }

      const urls: Set<string> = new Set();
      const ossBaseUrl = config.oss.baseUrl;

      const extractFromValue = (value: any): void => {
        if (typeof value === 'string') {
          // Check if it's an OSS URL
          if (value.includes(ossBaseUrl)) {
            urls.add(value);
          }
        } else if (Array.isArray(value)) {
          value.forEach(extractFromValue);
        } else if (typeof value === 'object' && value !== null) {
          Object.values(value).forEach(extractFromValue);
        }
      };

      extractFromValue(data);
      return Array.from(urls);
    },

    /**
     * Extract object path from full URL
     * e.g., "https://bucket.oss.com/uploads/image.jpg" → "uploads/image.jpg"
     */
    urlToObjectPath(url: string): string | null {
      const config = getMediaConfig();
      if (!config) {
        return null;
      }

      // Remove base URL to get object path
      if (url.includes(config.oss.baseUrl)) {
        return url.replace(config.oss.baseUrl + '/', '').replace(config.oss.baseUrl, '');
      }
      if (url.includes(config.minio.baseUrl)) {
        return url.replace(config.minio.baseUrl + '/', '').replace(config.minio.baseUrl, '');
      }

      return null;
    },

    /**
     * Sync media files referenced in content (on-demand sync)
     * Called when content is received from master to immediately download images
     * 
     * @param data - Content data containing media URLs
     * @returns Number of files synced
     */
    async syncContentMedia(data: any): Promise<{ synced: number; skipped: number; failed: number }> {
      const config = getMediaConfig();
      if (!config || !ossClient || !minioClient) {
        return { synced: 0, skipped: 0, failed: 0 };
      }

      const result = { synced: 0, skipped: 0, failed: 0 };

      try {
        // Extract all media URLs from content
        const urls = this.extractMediaUrls(data);

        if (urls.length === 0) {
          return result;
        }

        strapi.log.debug(`[MediaSync] On-demand sync: Found ${urls.length} media URLs in content`);

        // Ensure bucket exists
        await ensureBucket();

        // Sync each file
        for (const url of urls) {
          const objectPath = this.urlToObjectPath(url);
          if (!objectPath) {
            continue;
          }

          try {
            // Check if already exists in MinIO
            const exists = await fileExistsInMinio(objectPath);
            if (exists) {
              result.skipped++;
              continue;
            }

            // Download from OSS and upload to MinIO
            const success = await syncFile(objectPath);
            if (success) {
              result.synced++;
              strapi.log.debug(`[MediaSync] ✅ On-demand synced: ${objectPath}`);
            } else {
              result.failed++;
            }
          } catch (fileError: any) {
            result.failed++;
            strapi.log.debug(`[MediaSync] Failed to sync ${objectPath}: ${fileError.message}`);
          }
        }

        if (result.synced > 0) {
          strapi.log.info(`[MediaSync] 🖼️ On-demand sync: ${result.synced} files downloaded, ${result.skipped} skipped, ${result.failed} failed`);
        }

        return result;
      } catch (error: any) {
        strapi.log.error(`[MediaSync] On-demand sync error: ${error.message}`);
        return result;
      }
    },

    /**
     * Sync a single URL (download if not exists)
     */
    async syncUrl(url: string): Promise<boolean> {
      const objectPath = this.urlToObjectPath(url);
      if (!objectPath) {
        return false;
      }

      const config = getMediaConfig();
      if (!config || !ossClient || !minioClient) {
        return false;
      }

      try {
        // Check if already exists
        const exists = await fileExistsInMinio(objectPath);
        if (exists) {
          return true; // Already synced
        }

        // Sync the file
        return await syncFile(objectPath);
      } catch {
        return false;
      }
    },

    /**
     * Get file count from OSS bucket
     */
    async getOssFileCount(): Promise<{ count: number; error?: string }> {
      const config = getMediaConfig();
      if (!config || !ossClient) {
        return { count: 0, error: 'OSS client not initialized' };
      }

      try {
        const prefix = config.oss.uploadPath
          ? (config.oss.uploadPath.endsWith('/') ? config.oss.uploadPath : config.oss.uploadPath + '/')
          : '';

        let count = 0;
        const objectsStream = ossClient.listObjects(config.oss.bucket, prefix, true);

        for await (const obj of objectsStream) {
          if (obj.name) {
            count++;
          }
        }

        return { count };
      } catch (error: any) {
        strapi.log.error(`[MediaSync] Failed to count OSS files: ${error.message}`);
        return { count: 0, error: error.message };
      }
    },

    /**
     * Get file count from MinIO bucket
     */
    async getMinioFileCount(): Promise<{ count: number; error?: string }> {
      const config = getMediaConfig();
      if (!config || !minioClient) {
        return { count: 0, error: 'MinIO client not initialized' };
      }

      try {
        // Check if bucket exists first
        const bucketExists = await minioClient.bucketExists(config.minio.bucket);
        if (!bucketExists) {
          return { count: 0, error: 'Bucket does not exist' };
        }

        let count = 0;
        const objectsStream = minioClient.listObjects(config.minio.bucket, '', true);

        for await (const obj of objectsStream) {
          if (obj.name) {
            count++;
          }
        }

        return { count };
      } catch (error: any) {
        strapi.log.error(`[MediaSync] Failed to count MinIO files: ${error.message}`);
        return { count: 0, error: error.message };
      }
    },

    // =====================================================
    // REVERSE SYNC: MinIO (Replica) → OSS (Master)
    // =====================================================

    /**
     * Upload a file from MinIO to OSS (reverse sync)
     * Used when replica uploads new media and pushes to master
     */
    async uploadFileToOss(objectName: string): Promise<boolean> {
      const config = getMediaConfig();
      if (!config || !ossClient || !minioClient) {
        strapi.log.warn('[MediaSync] Cannot upload to OSS - clients not initialized');
        return false;
      }

      try {
        strapi.log.debug(`[MediaSync] Attempting to get file from MinIO: bucket=${config.minio.bucket}, object=${objectName}`);
        
        // Get file from MinIO
        const dataStream = await minioClient.getObject(config.minio.bucket, objectName);
        const stat = await minioClient.statObject(config.minio.bucket, objectName);

        strapi.log.debug(`[MediaSync] File found in MinIO: size=${stat.size}, contentType=${stat.metaData?.['content-type'] || 'unknown'}`);

        // Determine the target path in OSS
        // Preserve the full path from MinIO (including /uploads if present)
        // Example: 
        // - MinIO path: uploads/file.jpg -> OSS path: uploads/file.jpg
        // - MinIO path: file.jpg -> OSS path: uploads/file.jpg (if uploadPath is set)
        let ossObjectName = objectName;
        const uploadPath = config.oss.uploadPath?.replace(/\/$/, '') || '';
        
        if (uploadPath) {
          // If MinIO path already starts with uploadPath, use as-is
          // Otherwise, prepend uploadPath
          if (objectName.startsWith(`${uploadPath}/`)) {
            // Already has the prefix (e.g., uploads/file.jpg), use as-is
            ossObjectName = objectName;
            strapi.log.debug(`[MediaSync] MinIO path already includes uploadPath, using as-is: ${ossObjectName}`);
          } else {
            // Add the prefix (e.g., file.jpg -> uploads/file.jpg)
            ossObjectName = `${uploadPath}/${objectName}`;
            strapi.log.debug(`[MediaSync] Prepending uploadPath to MinIO path: ${objectName} -> ${ossObjectName}`);
          }
        } else {
          // No uploadPath configured, use MinIO path as-is
          strapi.log.debug(`[MediaSync] No uploadPath configured, using MinIO path as-is: ${ossObjectName}`);
        }

        strapi.log.debug(`[MediaSync] Uploading to OSS: bucket=${config.oss.bucket}, object=${ossObjectName}`);

        // Upload to OSS
        await ossClient.putObject(
          config.oss.bucket,
          ossObjectName,
          dataStream,
          stat.size,
          { 'Content-Type': stat.metaData?.['content-type'] || 'application/octet-stream' }
        );

        strapi.log.info(`[MediaSync] ⬆️ Uploaded to OSS: ${objectName} → ${ossObjectName}`);
        return true;
      } catch (error: any) {
        strapi.log.error(`[MediaSync] Failed to upload ${objectName} to OSS: ${error.message}`);
        strapi.log.error(`[MediaSync] Error details: ${JSON.stringify({
          bucket: config.oss.bucket,
          objectName,
          ossObjectName: config.oss.uploadPath ? `${config.oss.uploadPath}/${objectName}` : objectName,
          errorCode: error.code,
          errorMessage: error.message,
        })}`);
        return false;
      }
    },

    /**
     * Check if file exists in OSS
     */
    async fileExistsInOss(objectName: string): Promise<boolean> {
      const config = getMediaConfig();
      if (!config || !ossClient) {
        return false;
      }

      try {
        // Use the same path logic as uploadFileToOss
        // Preserve the full path from MinIO (including /uploads if present)
        let ossObjectName = objectName;
        const uploadPath = config.oss.uploadPath?.replace(/\/$/, '') || '';
        
        if (uploadPath) {
          // If MinIO path already starts with uploadPath, use as-is
          // Otherwise, prepend uploadPath
          if (objectName.startsWith(`${uploadPath}/`)) {
            // Already has the prefix (e.g., uploads/file.jpg), use as-is
            ossObjectName = objectName;
          } else {
            // Add the prefix (e.g., file.jpg -> uploads/file.jpg)
            ossObjectName = `${uploadPath}/${objectName}`;
          }
        }

        await ossClient.statObject(config.oss.bucket, ossObjectName);
        strapi.log.debug(`[MediaSync] File exists in OSS: ${ossObjectName}`);
        return true;
      } catch (error: any) {
        // File doesn't exist - this is expected for new files
        strapi.log.debug(`[MediaSync] File not found in OSS: ${objectName} (will upload)`);
        return false;
      }
    },

    /**
     * Extract file IDs from content data
     * Looks for media relations in the content
     */
    extractFileIds(data: any): string[] {
      const fileIds: Set<string> = new Set();

      const extractFromValue = (value: any): void => {
        if (!value) return;

        // Check if this is a file/media object (has id and url or mime)
        if (typeof value === 'object' && !Array.isArray(value)) {
          if (value.id && (value.url || value.mime)) {
            fileIds.add(String(value.id));
          }
          // Also check nested properties
          Object.values(value).forEach(extractFromValue);
        } else if (Array.isArray(value)) {
          value.forEach(extractFromValue);
        }
      };

      extractFromValue(data);
      return Array.from(fileIds);
    },

    /**
     * Extract object paths from MinIO URLs in content
     * Returns paths relative to the bucket
     */
    extractMinioObjectPaths(data: any): string[] {
      const config = getMediaConfig();
      if (!config) return [];

      const paths: Set<string> = new Set();
      const minioBaseUrl = config.minio.baseUrl.replace(/\/$/, '');

      const extractFromValue = (value: any): void => {
        if (typeof value === 'string') {
          if (value.includes(minioBaseUrl)) {
            // Extract path after the base URL
            // Example URLs:
            // - http://localhost:9000/media/uploads/0000bc_06b03ed573.jpg -> uploads/0000bc_06b03ed573.jpg
            // - http://localhost:9000/media/0000bc_06b03ed573.jpg -> 0000bc_06b03ed573.jpg
            let url = value.replace(minioBaseUrl, '').replace(/^\//, '');
            
            // Keep the full path as-is (including /uploads prefix if present)
            // The path should match exactly how it's stored in MinIO bucket
            if (url) {
              paths.add(url);
              strapi.log.debug(`[MediaSync] Extracted MinIO path from URL: ${value} -> ${url}`);
            }
          }
        } else if (Array.isArray(value)) {
          value.forEach(extractFromValue);
        } else if (typeof value === 'object' && value !== null) {
          Object.values(value).forEach(extractFromValue);
        }
      };

      extractFromValue(data);
      const pathsArray = Array.from(paths);
      
      if (pathsArray.length === 0) {
        // Log the data structure to help debug why no paths were found
        strapi.log.warn('[MediaSync] No MinIO paths extracted from data');
        strapi.log.debug(`[MediaSync] MinIO baseUrl: ${minioBaseUrl}`);
        strapi.log.debug(`[MediaSync] Sample data structure: ${JSON.stringify(data, null, 2).substring(0, 500)}`);
      } else {
        strapi.log.debug(`[MediaSync] Extracted ${pathsArray.length} MinIO paths: ${pathsArray.join(', ')}`);
      }
      
      return pathsArray;
    },

    /**
     * Sync content media to OSS before push (replica → master)
     * Uploads any files referenced in content from MinIO to OSS
     */
    async syncContentMediaToOss(data: any): Promise<{ synced: number; failed: number }> {
      const result = { synced: 0, failed: 0 };

      const config = getMediaConfig();
      if (!config || !ossClient || !minioClient) {
        if (!config) {
          strapi.log.warn('[MediaSync] Media sync config not available');
        } else if (!ossClient) {
          strapi.log.warn('[MediaSync] OSS client not initialized - check OSS credentials');
        } else if (!minioClient) {
          strapi.log.warn('[MediaSync] MinIO client not initialized - check MinIO connection');
        }
        return result;
      }

      try {
        // Extract MinIO paths from content
        const objectPaths = this.extractMinioObjectPaths(data);

        if (objectPaths.length === 0) {
          strapi.log.debug('[MediaSync] No MinIO paths found in content data');
          return result;
        }

        strapi.log.info(`[MediaSync] 🔄 Syncing ${objectPaths.length} files to OSS before push...`);
        strapi.log.debug(`[MediaSync] Extracted paths: ${objectPaths.join(', ')}`);

        for (const objectPath of objectPaths) {
          try {
            // Check if file exists in MinIO first
            const existsInMinio = await this.fileExistsInMinio(objectPath);
            if (!existsInMinio) {
              strapi.log.warn(`[MediaSync] ⚠️ File not found in MinIO: ${objectPath} (bucket: ${config.minio.bucket})`);
              result.failed++;
              continue;
            }

            // Check if already exists in OSS
            const existsInOss = await this.fileExistsInOss(objectPath);
            if (existsInOss) {
              strapi.log.info(`[MediaSync] ✅ File already exists in OSS: ${objectPath} - skipping upload`);
              result.synced++; // Count as success
              continue;
            }

            // File doesn't exist in OSS - upload it now
            strapi.log.info(`[MediaSync] 📤 File not found in OSS, uploading ${objectPath} from MinIO to OSS...`);
            const success = await this.uploadFileToOss(objectPath);
            if (success) {
              result.synced++;
              strapi.log.info(`[MediaSync] ✅ Successfully uploaded ${objectPath} to OSS`);
            } else {
              result.failed++;
              strapi.log.error(`[MediaSync] ❌ Failed to upload ${objectPath} to OSS - check logs above for details`);
            }
          } catch (fileError: any) {
            result.failed++;
            strapi.log.error(`[MediaSync] Failed to sync ${objectPath} to OSS: ${fileError.message}`);
            strapi.log.error(`[MediaSync] Error stack: ${fileError.stack}`);
          }
        }

        if (result.synced > 0 || result.failed > 0) {
          strapi.log.info(`[MediaSync] ⬆️ Sync completed: ${result.synced} synced, ${result.failed} failed`);
        }

        return result;
      } catch (error: any) {
        strapi.log.error(`[MediaSync] Content media to OSS sync error: ${error.message}`);
        strapi.log.error(`[MediaSync] Error stack: ${error.stack}`);
        return result;
      }
    },

    /**
     * Get file records from Strapi database by IDs
     * Returns the full file metadata needed to recreate on master
     */
    async getFileRecords(fileIds: string[]): Promise<any[]> {
      if (!fileIds || fileIds.length === 0) {
        return [];
      }

      try {
        // Query the files table
        const files = await strapi.db.query('plugin::upload.file').findMany({
          where: {
            id: { $in: fileIds.map(id => parseInt(id, 10)) },
          },
        });

        return files.map((file: any) => ({
          id: file.id,
          documentId: file.documentId,
          name: file.name,
          alternativeText: file.alternativeText,
          caption: file.caption,
          width: file.width,
          height: file.height,
          formats: file.formats,
          hash: file.hash,
          ext: file.ext,
          mime: file.mime,
          size: file.size,
          url: file.url,
          previewUrl: file.previewUrl,
          provider: file.provider,
          provider_metadata: file.provider_metadata,
          folderPath: file.folderPath,
        }));
      } catch (error: any) {
        strapi.log.error(`[MediaSync] Failed to get file records: ${error.message}`);
        return [];
      }
    },

    /**
     * Create file record on master from replica's file metadata
     * Used when master receives content with new media from replica
     */
    async createFileRecordFromReplica(fileData: any): Promise<any> {
      try {
        // Transform URL from MinIO to OSS
        const ossUrl = this.minioUrlToOssUrl(fileData.url);

        // Also transform formats URLs if present
        let transformedFormats = fileData.formats;
        if (fileData.formats && typeof fileData.formats === 'object') {
          transformedFormats = {};
          for (const [key, format] of Object.entries(fileData.formats)) {
            const f = format as any;
            transformedFormats[key] = {
              ...f,
              url: f.url ? this.minioUrlToOssUrl(f.url) : f.url,
            };
          }
        }

        // Create the file record
        const created = await strapi.db.query('plugin::upload.file').create({
          data: {
            name: fileData.name,
            alternativeText: fileData.alternativeText,
            caption: fileData.caption,
            width: fileData.width,
            height: fileData.height,
            formats: transformedFormats,
            hash: fileData.hash,
            ext: fileData.ext,
            mime: fileData.mime,
            size: fileData.size,
            url: ossUrl,
            previewUrl: fileData.previewUrl ? this.minioUrlToOssUrl(fileData.previewUrl) : null,
            provider: 'aliyun-oss', // Master uses OSS
            provider_metadata: fileData.provider_metadata,
            folderPath: fileData.folderPath,
          },
        });

        strapi.log.info(`[MediaSync] ✅ Created file record: ${created.id} (${fileData.name})`);
        return created;
      } catch (error: any) {
        strapi.log.error(`[MediaSync] Failed to create file record: ${error.message}`);
        return null;
      }
    },

    /**
     * Convert MinIO URL to OSS URL
     */
    minioUrlToOssUrl(minioUrl: string): string {
      const config = getMediaConfig();
      if (!config || !minioUrl) {
        return minioUrl;
      }

      const minioBaseUrl = config.minio.baseUrl.replace(/\/$/, '');
      const ossBaseUrl = config.oss.baseUrl.replace(/\/$/, '');

      if (minioUrl.includes(minioBaseUrl)) {
        // Get the path after MinIO base URL
        const path = minioUrl.replace(minioBaseUrl, '').replace(/^\//, '');

        // If OSS uses uploadPath, prepend it
        const ossPath = config.oss.uploadPath
          ? `${config.oss.uploadPath.replace(/\/$/, '')}/${path}`
          : path;

        return `${ossBaseUrl}/${ossPath}`;
      }

      return minioUrl;
    },

    /**
     * OSS URL to MinIO URL (already exists as transformToReplica, but this is simpler)
     */
    ossUrlToMinioUrl(ossUrl: string): string {
      const config = getMediaConfig();
      if (!config || !ossUrl) {
        return ossUrl;
      }

      const ossBaseUrl = config.oss.baseUrl.replace(/\/$/, '');
      const minioBaseUrl = config.minio.baseUrl.replace(/\/$/, '');

      if (ossUrl.includes(ossBaseUrl)) {
        let path = ossUrl.replace(ossBaseUrl, '').replace(/^\//, '');

        // Remove uploadPath prefix if present
        if (config.oss.uploadPath) {
          const uploadPrefix = config.oss.uploadPath.replace(/\/$/, '') + '/';
          if (path.startsWith(uploadPrefix)) {
            path = path.substring(uploadPrefix.length);
          }
        }

        return `${minioBaseUrl}/${path}`;
      }

      return ossUrl;
    },

    /**
     * Prepare content for push to master
     * - Syncs media files to OSS
     * - Collects file records that need to be created on master
     */
    async prepareContentForMasterPush(data: any): Promise<{
      fileRecords: any[];
      fileSyncResult: { synced: number; failed: number };
    }> {
      const result = {
        fileRecords: [] as any[],
        fileSyncResult: { synced: 0, failed: 0 },
      };

      const config = getMediaConfig();
      if (!config) {
        strapi.log.warn('[MediaSync] prepareContentForMasterPush: Media sync config not available');
        return result;
      }

      try {
        strapi.log.info('[MediaSync] 🔄 Preparing content for master push...');
        strapi.log.info(`[MediaSync] Content data keys: ${Object.keys(data || {}).join(', ')}`);
        
        // Log a sample of the data to see structure
        const dataSample = JSON.stringify(data, null, 2).substring(0, 1000);
        strapi.log.debug(`[MediaSync] Content data sample: ${dataSample}...`);
        
        // 1. Sync media files from MinIO to OSS
        strapi.log.info('[MediaSync] Starting syncContentMediaToOss...');
        result.fileSyncResult = await this.syncContentMediaToOss(data);
        
        strapi.log.info(`[MediaSync] ✅ Media sync result: ${result.fileSyncResult.synced} synced, ${result.fileSyncResult.failed} failed`);
        
        if (result.fileSyncResult.synced === 0 && result.fileSyncResult.failed === 0) {
          strapi.log.warn('[MediaSync] ⚠️ No files were processed - check if content contains MinIO URLs');
        }

        // 2. Extract file IDs and get their records
        const fileIds = this.extractFileIds(data);
        if (fileIds.length > 0) {
          result.fileRecords = await this.getFileRecords(fileIds);
          
          // 3. Transform URLs in file records from MinIO to OSS
          // This ensures master receives OSS URLs directly
          result.fileRecords = result.fileRecords.map((fileRecord: any) => {
            const transformedRecord = { ...fileRecord };
            // Transform main URL
            if (fileRecord.url) {
              transformedRecord.url = this.minioUrlToOssUrl(fileRecord.url);
            }
            // Transform preview URL
            if (fileRecord.previewUrl) {
              transformedRecord.previewUrl = this.minioUrlToOssUrl(fileRecord.previewUrl);
            }
            // Transform formats URLs
            if (fileRecord.formats && typeof fileRecord.formats === 'object') {
              transformedRecord.formats = {};
              for (const [key, format] of Object.entries(fileRecord.formats)) {
                const f = format as any;
                transformedRecord.formats[key] = {
                  ...f,
                  url: f.url ? this.minioUrlToOssUrl(f.url) : f.url,
                };
              }
            }
            return transformedRecord;
          });
          
          strapi.log.info(`[MediaSync] 📦 Prepared ${result.fileRecords.length} file records for push (URLs transformed to OSS)`);
        }

        return result;
      } catch (error: any) {
        strapi.log.error(`[MediaSync] Failed to prepare content for push: ${error.message}`);
        return result;
      }
    },

    /**
     * Process file records received from replica (master side)
     * Creates corresponding file records on master
     * Returns a mapping of old IDs to new IDs
     */
    async processReplicaFileRecords(fileRecords: any[]): Promise<Map<number, number>> {
      const idMapping = new Map<number, number>();

      if (!fileRecords || fileRecords.length === 0) {
        return idMapping;
      }

      for (const fileData of fileRecords) {
        try {
          // Check if file with same hash already exists
          const existing = await strapi.db.query('plugin::upload.file').findOne({
            where: { hash: fileData.hash },
          });

          if (existing) {
            // File already exists, map old ID to existing ID
            idMapping.set(fileData.id, existing.id);
            strapi.log.debug(`[MediaSync] File already exists: ${fileData.hash} → ${existing.id}`);
          } else {
            // Create new file record
            const created = await this.createFileRecordFromReplica(fileData);
            if (created) {
              idMapping.set(fileData.id, created.id);
            }
          }
        } catch (error: any) {
          strapi.log.error(`[MediaSync] Failed to process file record ${fileData.id}: ${error.message}`);
        }
      }

      strapi.log.info(`[MediaSync] 📥 Processed ${idMapping.size} file records from replica`);
      return idMapping;
    },

    /**
     * Update content data with new file IDs after file records are created on master
     */
    updateContentFileIds(data: any, idMapping: Map<number, number>): any {
      if (!data || idMapping.size === 0) {
        return data;
      }

      const updateValue = (value: any): any => {
        if (!value) return value;

        if (typeof value === 'object' && !Array.isArray(value)) {
          // Check if this is a file reference
          if (value.id && (value.url || value.mime)) {
            const oldId = parseInt(String(value.id), 10);
            const newId = idMapping.get(oldId);
            if (newId) {
              return { ...value, id: newId };
            }
          }

          // Recursively update nested objects
          const updated: any = {};
          for (const [key, val] of Object.entries(value)) {
            updated[key] = updateValue(val);
          }
          return updated;
        } else if (Array.isArray(value)) {
          return value.map(updateValue);
        }

        return value;
      };

      return updateValue(data);
    },
  };
};
