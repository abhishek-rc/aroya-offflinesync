/**
 * First-time Media Sync: OSS (Alibaba Cloud) → MinIO (Local)
 * 
 * Downloads all media files from OSS to local MinIO for replica/ship setup.
 * Run this once when setting up a new replica, before starting Strapi.
 * 
 * Usage:
 *   npm run sync:media
 *   npm run sync:media -- --batch-size=5 --batch-delay=300
 *   npm run sync:media -- --dry-run
 * 
 * Requires environment variables (from .env):
 *   OSS_REGION, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET, OSS_UPLOAD_PATH
 *   MINIO_ENDPOINT, MINIO_PORT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET
 */

const { Client: MinioClient } = require('minio');
require('dotenv').config();

// ── CLI arguments ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultValue;
};
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = parseInt(getArg('batch-size', '3'), 10);
const BATCH_DELAY_MS = parseInt(getArg('batch-delay', '500'), 10);
const MAX_RETRIES = parseInt(getArg('max-retries', '5'), 10);
const MAX_FILES = parseInt(getArg('max-files', '0'), 10); // 0 = unlimited

// ── OSS config ─────────────────────────────────────────────────────
const OSS_CONFIG = {
  endPoint: (process.env.OSS_REGION || 'oss-cn-hangzhou') + '.aliyuncs.com',
  port: 443,
  useSSL: true,
  accessKey: process.env.OSS_ACCESS_KEY_ID,
  secretKey: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
  region: process.env.OSS_REGION || 'oss-cn-hangzhou',
  uploadPath: process.env.OSS_UPLOAD_PATH || 'uploads',
  pathStyle: false,
};

// ── MinIO config ───────────────────────────────────────────────────
const MINIO_CONFIG = {
  endPoint: (process.env.MINIO_ENDPOINT || 'localhost').replace(/^https?:\/\//, '').replace(/:\d+$/, ''),
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
  bucket: process.env.MINIO_BUCKET || 'media',
};

// ── Helpers ────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Media Sync: OSS → MinIO (first-time setup)');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  // Validate config
  if (!OSS_CONFIG.accessKey || !OSS_CONFIG.secretKey || !OSS_CONFIG.bucket) {
    console.error('Missing OSS credentials. Set OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET in .env');
    process.exit(1);
  }

  console.log(`  OSS Endpoint : ${OSS_CONFIG.endPoint}`);
  console.log(`  OSS Bucket   : ${OSS_CONFIG.bucket}`);
  console.log(`  OSS Prefix   : ${OSS_CONFIG.uploadPath || '(root)'}`);
  console.log(`  MinIO        : ${MINIO_CONFIG.endPoint}:${MINIO_CONFIG.port}`);
  console.log(`  MinIO Bucket : ${MINIO_CONFIG.bucket}`);
  console.log(`  Batch Size   : ${BATCH_SIZE} files`);
  console.log(`  Batch Delay  : ${BATCH_DELAY_MS}ms`);
  console.log(`  Max Retries  : ${MAX_RETRIES}`);
  if (MAX_FILES > 0) console.log(`  Max Files    : ${MAX_FILES}`);
  if (DRY_RUN) console.log('  Mode         : DRY RUN (no files will be downloaded)');
  console.log('');

  // Create clients
  const ossClient = new MinioClient({
    endPoint: OSS_CONFIG.endPoint,
    port: OSS_CONFIG.port,
    useSSL: OSS_CONFIG.useSSL,
    accessKey: OSS_CONFIG.accessKey,
    secretKey: OSS_CONFIG.secretKey,
    region: OSS_CONFIG.region,
    pathStyle: OSS_CONFIG.pathStyle,
  });

  const minioClient = new MinioClient({
    endPoint: MINIO_CONFIG.endPoint,
    port: MINIO_CONFIG.port,
    useSSL: MINIO_CONFIG.useSSL,
    accessKey: MINIO_CONFIG.accessKey,
    secretKey: MINIO_CONFIG.secretKey,
  });

  // Test connections
  console.log('Testing connections...');
  try {
    const ossBucketExists = await ossClient.bucketExists(OSS_CONFIG.bucket);
    if (!ossBucketExists) {
      console.error(`OSS bucket "${OSS_CONFIG.bucket}" not found`);
      process.exit(1);
    }
    console.log(`  OSS bucket "${OSS_CONFIG.bucket}" ✓`);
  } catch (err) {
    console.error(`  OSS connection failed: ${err.message}`);
    process.exit(1);
  }

  try {
    const minioBucketExists = await minioClient.bucketExists(MINIO_CONFIG.bucket);
    if (!minioBucketExists) {
      console.log(`  MinIO bucket "${MINIO_CONFIG.bucket}" not found, creating...`);
      await minioClient.makeBucket(MINIO_CONFIG.bucket);
      console.log(`  MinIO bucket "${MINIO_CONFIG.bucket}" created ✓`);
    } else {
      console.log(`  MinIO bucket "${MINIO_CONFIG.bucket}" ✓`);
    }
  } catch (err) {
    console.error(`  MinIO connection failed: ${err.message}`);
    console.error('  Make sure MinIO is running (docker-compose -f src/plugins/offline-sync/docker/docker-compose.minio.yml up -d)');
    process.exit(1);
  }

  // List all files from OSS
  const prefix = OSS_CONFIG.uploadPath
    ? (OSS_CONFIG.uploadPath.endsWith('/') ? OSS_CONFIG.uploadPath : OSS_CONFIG.uploadPath + '/')
    : '';

  console.log('');
  console.log(`Listing files from OSS (prefix: "${prefix || '(root)'}")...`);

  const allObjects = [];
  const objectsStream = ossClient.listObjects(OSS_CONFIG.bucket, prefix, true);

  for await (const obj of objectsStream) {
    if (obj.name) {
      allObjects.push({ name: obj.name, size: obj.size || 0 });
    }
  }

  console.log(`Found ${allObjects.length} files in OSS`);

  if (allObjects.length === 0) {
    console.log('No files to sync. Done.');
    process.exit(0);
  }

  // Apply max-files limit
  const filesToProcess = MAX_FILES > 0 ? allObjects.slice(0, MAX_FILES) : allObjects;
  if (MAX_FILES > 0 && allObjects.length > MAX_FILES) {
    console.log(`Processing first ${MAX_FILES} files (of ${allObjects.length} total)`);
  }

  // Check which files already exist in MinIO
  console.log('Checking which files already exist in MinIO...');
  const toDownload = [];
  let existingCount = 0;

  for (const obj of filesToProcess) {
    try {
      await minioClient.statObject(MINIO_CONFIG.bucket, obj.name);
      existingCount++;
    } catch {
      toDownload.push(obj);
    }
  }

  console.log(`  Already in MinIO: ${existingCount}`);
  console.log(`  Need to download: ${toDownload.length}`);
  console.log('');

  if (toDownload.length === 0) {
    console.log('All files already synced. Done!');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log('DRY RUN - No files downloaded. Remove --dry-run to actually sync.');
    process.exit(0);
  }

  // Download files in batches
  const startTime = Date.now();
  let downloaded = 0;
  let failed = 0;
  let totalBytes = 0;

  const syncFileWithRetry = async (objectName, attempt = 0) => {
    try {
      const dataStream = await ossClient.getObject(OSS_CONFIG.bucket, objectName);
      const stat = await ossClient.statObject(OSS_CONFIG.bucket, objectName);

      await minioClient.putObject(
        MINIO_CONFIG.bucket,
        objectName,
        dataStream,
        stat.size,
        { 'Content-Type': stat.metaData?.['content-type'] || 'application/octet-stream' }
      );

      totalBytes += stat.size;
      return true;
    } catch (err) {
      const isRateLimit = err.message?.includes('503') ||
                          err.message?.includes('429') ||
                          err.message?.includes('Service Unavailable') ||
                          err.code === 'ECONNRESET';

      if (isRateLimit && attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await sleep(delay);
        return syncFileWithRetry(objectName, attempt + 1);
      }

      return false;
    }
  };

  console.log(`Downloading ${toDownload.length} files (batch: ${BATCH_SIZE}, delay: ${BATCH_DELAY_MS}ms)...`);
  console.log('');

  for (let i = 0; i < toDownload.length; i += BATCH_SIZE) {
    const batch = toDownload.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(obj => syncFileWithRetry(obj.name))
    );

    results.forEach(success => {
      if (success) downloaded++;
      else failed++;
    });

    // Progress
    const done = i + batch.length;
    const elapsed = Date.now() - startTime;
    const rate = done > 0 ? (done / (elapsed / 1000)).toFixed(1) : '0';
    const eta = done > 0 ? formatDuration(((toDownload.length - done) / (done / elapsed))) : '?';
    const pct = ((done / toDownload.length) * 100).toFixed(1);

    // Print progress every 10 files or on last batch
    if (done % 10 === 0 || done === toDownload.length) {
      process.stdout.write(
        `\r  [${pct}%] ${done}/${toDownload.length} | ` +
        `${downloaded} ok, ${failed} fail | ` +
        `${formatBytes(totalBytes)} | ${rate} files/s | ETA: ${eta}   `
      );
    }

    // Delay between batches (skip on last)
    if (i + BATCH_SIZE < toDownload.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const totalTime = formatDuration(Date.now() - startTime);

  console.log('');
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Sync Complete');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Downloaded : ${downloaded} files (${formatBytes(totalBytes)})`);
  console.log(`  Failed     : ${failed} files`);
  console.log(`  Skipped    : ${existingCount} files (already existed)`);
  console.log(`  Total time : ${totalTime}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  if (failed > 0) {
    console.log(`${failed} files failed. Run again to retry.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
