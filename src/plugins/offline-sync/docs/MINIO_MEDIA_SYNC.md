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
2. **Strapi's offline-sync plugin** uses the `minio` npm package to:
   - Connect to both OSS (source) and MinIO (destination)
   - **On-demand sync**: Immediately download images when content is received
   - **Periodic sync**: Background sync every 5 minutes (catches any missed files)
   - Transform media URLs in content during sync
3. **When offline**: Ship serves all media from local MinIO
4. **When online**: Strapi syncs new files from OSS to MinIO

### On-Demand Sync (Production Feature)

When content with images is published on master:

```
T+0s    Master publishes content + image to OSS
T+1s    Replica receives content via Kafka
        └── On-demand sync: Downloads image from OSS → MinIO
        └── URL transformed: OSS → MinIO
        └── Content saved with MinIO URL
T+1s    User sees content with image ✅ (no delay!)
```

This ensures images are available **immediately** when content is received.

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
        syncOnStartup: true,
        syncInterval: 300000, // 5 minutes
        
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
| `media.syncOnStartup` | boolean | `true` | Run sync when Strapi starts |
| `media.syncInterval` | number | `300000` | Sync interval in ms (5 min) |
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
2. Connects to both OSS and MinIO
3. Creates MinIO bucket if not exists
4. Starts initial sync (if `syncOnStartup: true`)

### Periodic Sync
- Runs every `syncInterval` milliseconds
- Compares files in OSS vs MinIO
- Downloads only new/missing files
- Skips files that already exist

### When Offline
- Sync attempts fail silently (logged as debug)
- Local MinIO continues serving cached media
- Next sync happens when online

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

The media sync solution ensures ships can display all images and videos even when completely offline, with automatic sync when connectivity is restored.
