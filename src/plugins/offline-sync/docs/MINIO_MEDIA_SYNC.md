# MinIO Media Sync for Offline Ships

## Overview

This document describes the production-ready solution for serving media files (images, videos, documents) on ships when they are offline. The solution uses:

- **MinIO Server**: Open-source S3-compatible storage running locally on each ship
- **MinIO npm package**: Integrated sync logic within Strapi (no separate sync container needed)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MASTER (Shore)                                  │
│                                                                              │
│   ┌──────────────┐         ┌─────────────────────────────────────────────┐  │
│   │              │         │                                             │  │
│   │    Strapi    │────────▶│            Alibaba Cloud OSS                │  │
│   │    Master    │         │         (Primary Media Storage)             │  │
│   │              │         │                                             │  │
│   └──────────────┘         └──────────────────┬──────────────────────────┘  │
│                                               │                              │
└───────────────────────────────────────────────┼──────────────────────────────┘
                                                │
                                                │ Sync via minio npm package
                                                │ (when ship is online)
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SHIP (Replica)                                  │
│                                                                              │
│   ┌──────────────┐         ┌─────────────────────────────────────────────┐  │
│   │              │         │                                             │  │
│   │    Strapi    │────────▶│            Local MinIO                      │  │
│   │    Replica   │◀────────│         (Ship Media Storage)                │  │
│   │              │  sync   │                                             │  │
│   └──────────────┘         └─────────────────────────────────────────────┘  │
│                                                                              │
│                            ✅ Works completely offline!                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## How It Works

1. **MinIO Server** runs as a Docker container on the ship
2. **First-time bulk sync** is done via a standalone script (`npm run sync:media`) — run once when setting up a new replica to populate MinIO with all existing media from OSS
3. **On-demand sync** is built into the plugin: when new content arrives via Kafka, referenced media files are automatically downloaded from OSS to MinIO
4. **File record syncing**: Master includes `plugin::upload.file` metadata in Kafka messages (`fileRecords` field). Replica creates local file entries, enabling proper file relations
5. **No periodic background sync** — only bulk (one-time) and on-demand (per message)
6. **When offline**: Ship serves all media from local MinIO
7. **When online**: New files sync on-demand as content arrives

### On-Demand Sync (Built-in)

When content with images is published on master:

```
T+0s    Master publishes content + image to OSS
        └── Master attaches fileRecords to Kafka message
T+1s    Replica receives content via Kafka
        └── processMasterFileRecords(): creates local upload entries
        └── On-demand sync: Downloads image from OSS → MinIO
        └── URL transformed: OSS → MinIO
        └── Content saved with MinIO URL and local file relations
T+1s    User sees content with image ✅ (no delay!)
```

This ensures images are available **immediately** when content is received.

### First-Time Bulk Sync (Standalone Script)

For initial replica setup, run the standalone sync script to download all existing media:

```bash
npm run sync:media
```

CLI arguments:

| Argument | Default | Description |
|----------|---------|-------------|
| `--batch-size` | `50` | Number of files per batch |
| `--batch-delay` | `1000` | Delay between batches in ms |
| `--max-retries` | `3` | Max retries per file |
| `--max-files` | `0` (unlimited) | Limit total files to sync |
| `--dry-run` | `false` | Preview without downloading |

Example:

```bash
# Dry run to see what would be synced
npm run sync:media -- --dry-run

# Sync with custom batch settings
npm run sync:media -- --batch-size 100 --batch-delay 2000

# Sync limited number of files
npm run sync:media -- --max-files 500
```

The script runs `scripts/sync-media.js` which connects directly to OSS and MinIO without starting Strapi.

---

## Quick Start

### Step 1: Start MinIO Server on Ship

```bash
cd src/plugins/offline-sync/docker
docker-compose -f docker-compose.minio.yml up -d
```

Access MinIO Console: http://localhost:9001
- Username: `minioadmin`
- Password: `minioadmin123`

### Step 2: Configure Strapi Plugin

Add media sync configuration to `config/plugins.ts` on the **replica**:

```typescript
export default ({ env }) => ({
  'offline-sync': {
    enabled: true,
    config: {
      mode: 'replica',
      shipId: env('SYNC_SHIP_ID'),
      
      // ... existing kafka config ...
      
      // Media sync configuration
      media: {
        enabled: true,
        transformUrls: true,
        batchSize: 50,
        batchDelay: 1000,
        maxFilesPerSync: 0, // 0 = unlimited
        
        // OSS (Master) configuration
        oss: {
          endPoint: env('OSS_ENDPOINT', 'oss-cn-hangzhou.aliyuncs.com'),
          port: 443,
          useSSL: true,
          accessKey: env('OSS_ACCESS_KEY'),
          secretKey: env('OSS_SECRET_KEY'),
          bucket: env('OSS_BUCKET'),
          baseUrl: env('OSS_BASE_URL', 'https://your-bucket.oss-cn-hangzhou.aliyuncs.com'),
          region: env('OSS_REGION', 'oss-cn-hangzhou'),
          uploadPath: env('OSS_UPLOAD_PATH', 'strapi-uploads'),  // ← Important! Must match your OSS path
          pathStyle: false,  // false for Alibaba OSS (uses virtual-hosted style)
        },
        
        // MinIO (Local) configuration
        minio: {
          endPoint: env('MINIO_ENDPOINT', 'localhost'),
          port: parseInt(env('MINIO_PORT', '9000')),
          useSSL: false,
          accessKey: env('MINIO_ACCESS_KEY', 'minioadmin'),
          secretKey: env('MINIO_SECRET_KEY', 'minioadmin123'),
          bucket: env('MINIO_BUCKET', 'media'),
          baseUrl: env('MINIO_BASE_URL', 'http://localhost:9000/media'),
        },
      },
    },
  },
});
```

**Important:** The `uploadPath` must match the path where your Master Strapi stores files in OSS.
Check your master's upload config for `uploadPath` value (usually `strapi-uploads`).

### Step 3: Add Environment Variables

Add to `.env` on the replica:

```env
# OSS Configuration (Master source)
OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com
OSS_ACCESS_KEY=your-oss-access-key
OSS_SECRET_KEY=your-oss-secret-key
OSS_BUCKET=your-oss-bucket
OSS_BASE_URL=https://your-bucket.oss-cn-hangzhou.aliyuncs.com
OSS_REGION=oss-cn-hangzhou
OSS_UPLOAD_PATH=strapi-uploads   # ← Must match Master's upload path!

# MinIO Configuration (Local destination)
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET=media
MINIO_BASE_URL=http://localhost:9000/media
```

**Note:** Check your Master's `config/plugins.ts` for the `uploadPath` value. It's usually `strapi-uploads`.

### Step 4: Install Dependencies

```bash
cd src/plugins/offline-sync
npm install
```

### Step 5: Restart Strapi

```bash
npm run develop
```

---

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `media.enabled` | boolean | `false` | Enable media sync |
| `media.transformUrls` | boolean | `true` | Transform URLs in synced content |
| `media.batchSize` | number | `50` | Files per batch during bulk sync |
| `media.batchDelay` | number | `1000` | Delay between batches in ms |
| `media.maxFilesPerSync` | number | `0` | Max files per sync run (0 = unlimited) |
| `media.oss.endPoint` | string | - | OSS endpoint (e.g., `oss-cn-hangzhou.aliyuncs.com`) |
| `media.oss.bucket` | string | - | OSS bucket name |
| `media.oss.baseUrl` | string | - | Full URL for OSS media |
| `media.oss.region` | string | - | OSS region (e.g., `oss-cn-hangzhou`) |
| `media.oss.uploadPath` | string | `''` | **Important!** Path prefix in OSS (e.g., `strapi-uploads`) |
| `media.oss.pathStyle` | boolean | `false` | Use path-style URLs (false for Alibaba OSS) |
| `media.minio.endPoint` | string | `localhost` | MinIO host |
| `media.minio.port` | number | `9000` | MinIO port |
| `media.minio.bucket` | string | `media` | MinIO bucket name |
| `media.minio.baseUrl` | string | - | Full URL for MinIO media |

---

## How URL Transformation Works

### Content from Master → Replica

When replica receives content from master, URLs are transformed:

```
BEFORE (Master/OSS URL):
https://your-bucket.oss-cn-hangzhou.aliyuncs.com/uploads/image.jpg

AFTER (Replica/MinIO URL):
http://localhost:9000/media/uploads/image.jpg
```

### Content from Replica → Master

When replica sends content to master, URLs are transformed back:

```
BEFORE (Replica/MinIO URL):
http://localhost:9000/media/uploads/image.jpg

AFTER (Master/OSS URL):
https://your-bucket.oss-cn-hangzhou.aliyuncs.com/uploads/image.jpg
```

---

## Sync Behavior

### On Startup
1. Plugin checks if media sync is enabled
2. Initializes MinIO and OSS clients
3. Creates MinIO bucket if not exists
4. **No automatic file sync** — only client initialization and bucket verification

### On-Demand Sync (via Kafka)
- Triggered when content arrives from master via Kafka
- Downloads only the media files referenced by the incoming content
- Creates local `plugin::upload.file` entries from master's `fileRecords`
- Transforms URLs from OSS → MinIO in the content data

### Bulk Sync (Standalone Script)
- Run `npm run sync:media` for first-time setup or to catch up
- Compares files in OSS vs MinIO, downloads only new/missing files
- Runs outside of Strapi — no server restart needed
- See [First-Time Bulk Sync](#first-time-bulk-sync-standalone-script) for details

### When Offline
- On-demand sync attempts fail silently (logged via `strapi.log.error`)
- Local MinIO continues serving cached media
- New files sync on-demand when connectivity is restored

---

## API Endpoints

The media sync service is accessible via the offline-sync plugin:

```typescript
// Get media sync service
const mediaSync = strapi.plugin('offline-sync').service('media-sync');

// Check if enabled
const enabled = mediaSync.isEnabled();

// Manual sync
const stats = await mediaSync.sync();

// Get sync stats
const stats = mediaSync.getStats();
// Returns: { lastSyncAt, filesDownloaded, filesSkipped, filesFailed, totalBytes, isRunning, error }

// Health check
const health = await mediaSync.getHealth();
// Returns: { minioConnected, ossConnected, lastSync, isRunning }

// Transform URLs
const replicaData = mediaSync.transformToReplica(masterData);
const masterData = mediaSync.transformToMaster(replicaData);
```

---

## OSS-to-MinIO Path Mapping

The `ossPathToMinioPath` helper strips the upload prefix when copying files from OSS to MinIO. OSS stores files under a configurable `uploadPath` prefix (e.g., `strapi-uploads/`), but MinIO stores them at the root of the bucket.

```
OSS path:    uploads/image.jpg    →  MinIO path: image.jpg
OSS path:    strapi-uploads/photo.png  →  MinIO path: photo.png
```

This ensures MinIO URLs stay clean and the `baseUrl` configuration works without path duplication.

---

## File Record Syncing

When the master publishes content that references media files, it includes `plugin::upload.file` records in the Kafka message under the `fileRecords` field. On the replica side:

1. **Master** calls `getFileRecords(fileIds)` to fetch full file metadata (name, hash, ext, mime, size, url, etc.)
2. **Master** attaches the result as `fileRecords` in the `SyncMessage`
3. **Replica** receives the message and calls `processMasterFileRecords(fileRecords)` to:
   - Create local `plugin::upload.file` entries in the replica database
   - Build an ID map (master file ID → replica file ID)
4. **Replica** calls `updateContentFileIds(data, idMap)` to rewrite file references in the content so they point to the newly created local entries

This enables proper file relations on the replica without requiring the replica to re-upload files through Strapi's upload service.

---

## Making MinIO Bucket Public

By default, the MinIO bucket requires authentication to access objects. For Strapi to serve media directly, the bucket must be publicly readable.

### Option 1: Via MinIO CLI (mc)

```bash
docker exec ship-minio sh -c "mc alias set local http://localhost:9000 minioadmin minioadmin123 && mc anonymous set download local/media"
```

### Option 2: Via MinIO Console

1. Open http://localhost:9001
2. Go to **Administrator** → **Buckets** → **media**
3. Set **Access Policy** to **Public**

---

## Monitoring

### Check Sync Status

View Strapi logs for sync activity:

```
[MediaSync] Starting media sync from OSS to MinIO...
[MediaSync] Progress: 100 files processed
[MediaSync] ✅ Sync completed in 45.2s - Downloaded: 85, Skipped: 15, Failed: 0
```

### MinIO Console

Access http://localhost:9001 to:
- Browse uploaded files
- View storage usage
- Check bucket policies

---

## Troubleshooting

### MinIO Not Starting

```bash
# Check Docker logs
docker logs ship-minio

# Check if port is in use
netstat -tlnp | grep 9000

# Restart MinIO
docker-compose -f docker-compose.minio.yml restart
```

### Sync Not Working

1. Check Strapi logs for `[MediaSync]` messages
2. Verify OSS credentials are correct
3. Test OSS connectivity:
   ```typescript
   const health = await strapi.plugin('offline-sync').service('media-sync').getHealth();
   console.log(health);
   ```

### IPv6 Localhost Issues

If MinIO connections fail on some systems, `localhost` may resolve to `::1` (IPv6). Use the explicit IPv4 address instead:

```env
MINIO_ENDPOINT=127.0.0.1
MINIO_BASE_URL=http://127.0.0.1:9000/media
```

### Development Server Restarts

MinIO writes to the `public/uploads` directory can trigger Strapi's file watcher, causing repeated restarts. Add `watchIgnoreFiles` to your admin config:

```typescript
// config/admin.ts
export default ({ env }) => ({
  watchIgnoreFiles: [
    '**/public/uploads/**',
  ],
});
```

### Heap Out of Memory

Large bulk syncs may exceed Node's default memory limit. Increase it with:

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run sync:media
```

### Images Not Loading

1. Check if file exists in MinIO:
   - Open http://localhost:9001
   - Navigate to bucket
   - Search for file

2. Verify URL transformation:
   ```typescript
   const mediaSync = strapi.plugin('offline-sync').service('media-sync');
   const ossUrl = 'https://bucket.oss-cn-hangzhou.aliyuncs.com/test.jpg';
   const minioUrl = mediaSync.transformToReplica({ url: ossUrl });
   console.log(minioUrl);
   ```

3. Test MinIO direct access:
   ```bash
   curl http://localhost:9000/media/uploads/test.jpg
   ```

---

## Production Recommendations

### 1. Secure MinIO Credentials

```bash
# Generate strong password
openssl rand -base64 32

# Use in environment
MINIO_ROOT_PASSWORD=<generated-password>
```

### 2. Use Persistent Storage

The Docker Compose already uses a named volume. For production:

```yaml
volumes:
  minio_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /path/to/storage
```

### 3. Monitor Disk Space

```bash
# Check MinIO disk usage
docker exec ship-minio du -sh /data

# Set up alerts when > 80% full
```

### 4. Backup Strategy

```bash
# Backup MinIO data
docker run --rm \
  -v minio_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/minio-backup-$(date +%Y%m%d).tar.gz /data
```

---

## Summary

| Component | Master (Shore) | Replica (Ship) |
|-----------|---------------|----------------|
| Storage | Alibaba OSS | Local MinIO |
| Media URLs | `https://bucket.oss-*.com/...` | `http://localhost:9000/media/...` |
| Sync Direction | N/A (source) | OSS → MinIO |
| Works Offline | N/A | ✅ Yes |
| URL Transform | ✅ (MinIO→OSS) | ✅ (OSS→MinIO) |

The media sync solution ensures ships can display all images and videos even when completely offline, with on-demand sync when new content arrives via Kafka.
