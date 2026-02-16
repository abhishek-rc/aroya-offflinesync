# 🔄 Offline Sync Plugin for Strapi 5

A production-ready bi-directional sync plugin that enables offline-first data synchronization between a central **Master** instance and multiple **Replica** (ship) instances using Apache Kafka.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Master Mode](#master-mode-configuration)
  - [Replica Mode](#replica-mode-configuration)
- [API Endpoints](#api-endpoints)
- [Conflict Resolution](#conflict-resolution)
- [Monitoring & Health Checks](#monitoring--health-checks)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

The Offline Sync Plugin solves the challenge of keeping data synchronized between a central server (Master) and remote instances (Replicas/Ships) that may operate with intermittent or no connectivity.

### Use Cases

- **Maritime/Shipping**: Ships at sea with limited satellite connectivity
- **Remote Locations**: Field offices, warehouses, or retail stores with unreliable internet
- **Mobile Workforces**: Teams working in areas with poor network coverage
- **Disaster Recovery**: Maintaining data availability during network outages

### How It Works

```
┌─────────────────┐                         ┌─────────────────┐
│     MASTER      │                         │   REPLICA/SHIP  │
│   (Onshore)     │                         │   (Offshore)    │
├─────────────────┤                         ├─────────────────┤
│                 │   ship-updates topic    │                 │
│  Kafka Consumer │◄────────────────────────│ Kafka Producer  │
│                 │                         │                 │
│  Kafka Producer │────────────────────────►│ Kafka Consumer  │
│                 │  master-updates topic   │                 │
└─────────────────┘                         └─────────────────┘
         │                                           │
         ▼                                           ▼
    PostgreSQL                                  SQLite/PostgreSQL
    (Primary DB)                                (Local DB)
```

---

## ✨ Features

### Core Features

| Feature | Description |
|---------|-------------|
| **Bi-directional Sync** | Changes flow both ways: Replica → Master and Master → Replica |
| **Offline-First** | Replicas continue working offline, sync when connected |
| **Conflict Detection** | Automatic detection of concurrent edits |
| **Conflict Resolution** | Admin UI to resolve conflicts (keep-ship, keep-master, merge) |
| **Idempotent Processing** | Messages processed exactly once |
| **Dead Letter Queue** | Failed messages stored for retry/analysis |

### Reliability Features

| Feature | Description |
|---------|-------------|
| **Message Tracking** | Every message tracked with unique ID |
| **Automatic Retries** | Configurable retry attempts for failed operations |
| **Graceful Shutdown** | Clean disconnection of Kafka consumers/producers |
| **Heartbeat Monitoring** | Ships send periodic heartbeats to indicate online status |

### Monitoring Features

| Feature | Description |
|---------|-------------|
| **Health Endpoints** | Kubernetes-compatible liveness/readiness probes |
| **Prometheus Metrics** | Export metrics for monitoring dashboards |
| **Ship Registry** | Track all connected ships and their status |

---

## 🏗️ Architecture

### Components

```
offline-sync/
├── server/src/
│   ├── bootstrap.ts          # Plugin initialization & middleware
│   ├── services/
│   │   ├── sync-service.ts       # Core sync logic (push/pull/process)
│   │   ├── kafka-producer.ts     # Kafka message producer
│   │   ├── kafka-consumer.ts     # Kafka message consumer
│   │   ├── sync-queue.ts         # Local queue for pending operations
│   │   ├── conflict-resolver.ts  # Conflict detection & resolution
│   │   ├── document-mapping.ts   # Replica ↔ Master ID mapping
│   │   ├── message-tracker.ts    # Idempotency tracking
│   │   ├── dead-letter.ts        # Failed message handling
│   │   ├── ship-tracker.ts       # Ship registry & status
│   │   ├── connectivity-monitor.ts # Network status monitoring
│   │   └── version-manager.ts    # Version tracking
│   ├── controllers/
│   │   ├── sync.ts               # Sync API controller
│   │   ├── conflict.ts           # Conflict API controller
│   │   └── health.ts             # Health check controller
│   ├── routes/
│   │   ├── sync.ts               # Sync routes
│   │   ├── conflict.ts           # Conflict routes
│   │   └── health.ts             # Health routes
│   └── content-types/
│       ├── document-mapping/     # Replica ↔ Master document mapping
│       ├── processed-message/    # Processed message tracking
│       ├── dead-letter/          # Dead letter queue
│       └── ship-registry/        # Registered ships
```

### Data Flow

#### Ship → Master (Push)

1. User creates/updates/deletes content on Replica
2. Document middleware intercepts the action
3. Operation queued in `sync_queue` table
4. Kafka Producer sends message to `ship-updates` topic
5. Master's Kafka Consumer receives message
6. Master applies changes (with conflict detection)
7. Document mapping updated

#### Master → Ships (Pull)

1. User creates/updates/deletes content on Master
2. Document middleware intercepts the action
3. Kafka Producer sends message to `master-updates` topic
4. All Replica Kafka Consumers receive message
5. Each Replica applies changes locally
6. Document mapping updated

---

## 📦 Installation

The plugin is included in this Strapi project. No additional installation required.

### Prerequisites

- **Apache Kafka** cluster (or Confluent Cloud, AWS MSK, etc.)
- **PostgreSQL** (Master) or **SQLite/PostgreSQL** (Replica)

---

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SYNC_MODE` | Operating mode: `master` or `replica` | `replica` | ✅ |
| `SYNC_SHIP_ID` | Unique identifier for the ship | - | ✅ (replica) |
| `KAFKA_BROKERS` | Comma-separated Kafka broker addresses | `localhost:9092` | ✅ |
| `KAFKA_SSL_ENABLED` | Enable SSL/TLS | `false` | ❌ |
| `KAFKA_SASL_MECHANISM` | SASL mechanism (e.g., `plain`, `scram-sha-256`) | - | ❌ |
| `KAFKA_SASL_USERNAME` | SASL username | - | ❌ |
| `KAFKA_SASL_PASSWORD` | SASL password | - | ❌ |
| `KAFKA_TOPIC_SHIP_UPDATES` | Topic for ship → master messages | `ship-updates` | ❌ |
| `KAFKA_TOPIC_MASTER_UPDATES` | Topic for master → ship messages | `master-updates` | ❌ |
| `SYNC_BATCH_SIZE` | Max operations per sync batch | `100` | ❌ |
| `SYNC_RETRY_ATTEMPTS` | Retry attempts for failed operations | `3` | ❌ |
| `SYNC_RETRY_DELAY` | Delay between retries (ms) | `5000` | ❌ |
| `SYNC_CONNECTIVITY_CHECK_INTERVAL` | Connectivity check interval (ms) | `30000` | ❌ |
| `SYNC_DEBOUNCE_MS` | Debounce delay for instant push (ms) | `1000` | ❌ |
| `SYNC_CONTENT_TYPES` | Comma-separated content types to sync | All types | ❌ |

### Master Mode Configuration

Create a `.env` file for the Master instance:

```env
# .env (Master)
SYNC_MODE=master

# Kafka Configuration
KAFKA_BROKERS=kafka-broker1:9092,kafka-broker2:9092
KAFKA_SSL_ENABLED=true
KAFKA_SASL_MECHANISM=scram-sha-256
KAFKA_SASL_USERNAME=master-user
KAFKA_SASL_PASSWORD=your-secure-password

# Topic Configuration
KAFKA_TOPIC_SHIP_UPDATES=ship-updates
KAFKA_TOPIC_MASTER_UPDATES=master-updates

# Optional: Limit which content types to sync
# SYNC_CONTENT_TYPES=api::article.article,api::product.product

# Database (PostgreSQL recommended for Master)
DATABASE_CLIENT=postgres
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=strapi_master
DATABASE_USERNAME=strapi
DATABASE_PASSWORD=strapi
```

### Replica Mode Configuration

Create a `.env` file for each Replica/Ship instance:

```env
# .env (Replica/Ship)
SYNC_MODE=replica
SYNC_SHIP_ID=ship-atlantic-001

# Kafka Configuration
KAFKA_BROKERS=kafka-broker1:9092,kafka-broker2:9092
KAFKA_SSL_ENABLED=true
KAFKA_SASL_MECHANISM=scram-sha-256
KAFKA_SASL_USERNAME=ship-user
KAFKA_SASL_PASSWORD=your-secure-password

# Topic Configuration
KAFKA_TOPIC_SHIP_UPDATES=ship-updates
KAFKA_TOPIC_MASTER_UPDATES=master-updates

# Sync Settings
SYNC_BATCH_SIZE=50
SYNC_DEBOUNCE_MS=2000
SYNC_CONNECTIVITY_CHECK_INTERVAL=60000

# Optional: Limit which content types to sync
# SYNC_CONTENT_TYPES=api::article.article,api::product.product

# Database (SQLite for offline capability, or PostgreSQL)
DATABASE_CLIENT=sqlite
DATABASE_FILENAME=.tmp/data.db
```

### Plugin Configuration (config/plugins.ts)

```typescript
export default ({ env }) => ({
  'offline-sync': {
    enabled: true,
    resolve: './src/plugins/offline-sync',
    config: {
      mode: env('SYNC_MODE', 'replica'),
      shipId: env('SYNC_SHIP_ID'),
      kafka: {
        brokers: env('KAFKA_BROKERS', 'localhost:9092').split(','),
        ssl: env.bool('KAFKA_SSL_ENABLED', false),
        sasl: {
          mechanism: env('KAFKA_SASL_MECHANISM'),
          username: env('KAFKA_SASL_USERNAME'),
          password: env('KAFKA_SASL_PASSWORD'),
        },
        topics: {
          shipUpdates: env('KAFKA_TOPIC_SHIP_UPDATES', 'ship-updates'),
          masterUpdates: env('KAFKA_TOPIC_MASTER_UPDATES', 'master-updates'),
        },
      },
      sync: {
        batchSize: env.int('SYNC_BATCH_SIZE', 100),
        retryAttempts: env.int('SYNC_RETRY_ATTEMPTS', 3),
        retryDelay: env.int('SYNC_RETRY_DELAY', 5000),
        connectivityCheckInterval: env.int('SYNC_CONNECTIVITY_CHECK_INTERVAL', 30000),
        debounceMs: env.int('SYNC_DEBOUNCE_MS', 1000),
      },
      contentTypes: env('SYNC_CONTENT_TYPES', '').split(',').filter(Boolean),
    },
  },
});
```

---

## 🔌 API Endpoints

### Sync Endpoints

| Method | Endpoint | Description | Mode |
|--------|----------|-------------|------|
| `GET` | `/api/offline-sync/status` | Get sync status | Both |
| `POST` | `/api/offline-sync/push` | Trigger manual push | Replica |
| `POST` | `/api/offline-sync/pull` | Trigger manual pull | Replica |
| `GET` | `/api/offline-sync/queue` | Get sync queue | Replica |
| `GET` | `/api/offline-sync/queue/pending` | Get pending count | Replica |
| `GET` | `/api/offline-sync/ships` | List registered ships | Master |

### Conflict Endpoints

| Method | Endpoint | Description | Mode |
|--------|----------|-------------|------|
| `GET` | `/api/offline-sync/conflicts` | List unresolved conflicts | Master |
| `GET` | `/api/offline-sync/conflicts/:id` | Get conflict details | Master |
| `POST` | `/api/offline-sync/conflicts/:id/resolve` | Resolve a conflict | Master |

#### Resolve Conflict Request Body

```json
{
  "strategy": "keep-ship",  // or "keep-master" or "merge"
  "mergeData": {            // Required only for "merge" strategy
    "field1": "value1",
    "field2": "value2"
  }
}
```

### Health Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/offline-sync/health/live` | Liveness probe (K8s) |
| `GET` | `/api/offline-sync/health/ready` | Readiness probe (K8s) |
| `GET` | `/api/offline-sync/health` | Detailed health status |
| `GET` | `/api/offline-sync/health/metrics` | Prometheus metrics |

---

## ⚔️ Conflict Resolution

### When Conflicts Occur

A conflict is detected when:
1. A document exists on the Master (has been synced before)
2. The Master document was modified **after** the last sync from that ship
3. The ship sends an update for the same document

### Conflict Detection Logic

```
Ship Update Arrives
        │
        ▼
┌───────────────────┐
│ Get Document      │
│ Mapping           │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐     ┌─────────────────┐
│ Master.updatedAt  │────►│ Is Master newer │
│ vs                │     │ than last sync? │
│ Mapping.updatedAt │     └────────┬────────┘
└───────────────────┘              │
                           ┌───────┴───────┐
                           │               │
                          YES              NO
                           │               │
                           ▼               ▼
                    ┌──────────┐    ┌──────────┐
                    │ CONFLICT │    │ Apply    │
                    │ Logged   │    │ Update   │
                    └──────────┘    └──────────┘
```

### Resolution Strategies

| Strategy | Description | When to Use |
|----------|-------------|-------------|
| `keep-ship` | Apply ship's data, overwrite master | Ship has the correct/latest data |
| `keep-master` | Keep master's data, discard ship update | Master has the correct data |
| `merge` | Apply custom merged data | Combine changes from both |

### Viewing and Resolving Conflicts

```bash
# List all unresolved conflicts
curl http://localhost:1337/api/offline-sync/conflicts

# Get specific conflict details
curl http://localhost:1337/api/offline-sync/conflicts/1

# Resolve with keep-ship strategy
curl -X POST http://localhost:1337/api/offline-sync/conflicts/1/resolve \
  -H "Content-Type: application/json" \
  -d '{"strategy": "keep-ship"}'

# Resolve with merge strategy
curl -X POST http://localhost:1337/api/offline-sync/conflicts/1/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "strategy": "merge",
    "mergeData": {
      "title": "Merged Title",
      "description": "Combined description from both sources"
    }
  }'
```

---

## 📊 Monitoring & Health Checks

### Kubernetes Probes

```yaml
# deployment.yaml
livenessProbe:
  httpGet:
    path: /api/offline-sync/health/live
    port: 1337
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /api/offline-sync/health/ready
    port: 1337
  initialDelaySeconds: 5
  periodSeconds: 5
```

### Prometheus Metrics

The `/api/offline-sync/health/metrics` endpoint exports:

```prometheus
# HELP offline_sync_info Plugin information
# TYPE offline_sync_info gauge
offline_sync_info{mode="master",ship_id="master"} 1

# HELP offline_sync_uptime_seconds Process uptime in seconds
# TYPE offline_sync_uptime_seconds gauge
offline_sync_uptime_seconds 3600

# HELP offline_sync_messages_total Total messages processed
# TYPE offline_sync_messages_total counter
offline_sync_messages_total{status="processed"} 1250
offline_sync_messages_total{status="failed"} 5

# HELP offline_sync_ships_total Total registered ships
# TYPE offline_sync_ships_total gauge
offline_sync_ships_total 10

# HELP offline_sync_ships_online Ships currently online
# TYPE offline_sync_ships_online gauge
offline_sync_ships_online 8

# HELP offline_sync_dead_letter_total Dead letter queue items
# TYPE offline_sync_dead_letter_total gauge
offline_sync_dead_letter_total{status="pending"} 2
offline_sync_dead_letter_total{status="exhausted"} 1
```

### Health Check Response

```json
{
  "status": "healthy",
  "mode": "master",
  "shipId": null,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600.5,
  "version": "5.0.0",
  "checks": {
    "database": {
      "status": "healthy",
      "latency": 5,
      "type": "postgres"
    },
    "kafka": {
      "status": "healthy",
      "role": "consumer",
      "topics": "ship-updates"
    },
    "messageTracker": {
      "status": "healthy",
      "total": 1255,
      "processed": 1250,
      "failed": 5
    },
    "deadLetterQueue": {
      "status": "warning",
      "pending": 2,
      "exhausted": 1
    },
    "ships": {
      "status": "healthy",
      "total": 10,
      "online": 8,
      "offline": 2
    }
  }
}
```

---

## 🔧 Troubleshooting

### Common Issues

#### 1. Kafka Connection Failed

**Symptoms**: `Failed to connect Kafka producer/consumer`

**Solutions**:
- Verify `KAFKA_BROKERS` is correct
- Check firewall/network access to Kafka
- Verify SASL credentials if authentication is enabled
- Ensure Kafka topics exist or auto-creation is enabled

#### 2. Messages Not Being Received (Master)

**Symptoms**: Ship sends updates but Master doesn't process them

**Solutions**:
- Check Kafka consumer group: In development, set `KAFKA_CONSUMER_GROUP_SUFFIX` to avoid zombie consumers
- Restart with clean state: `npm run develop`
- Kill stale Node processes: `taskkill /F /IM node.exe` (Windows) or `pkill node` (Linux/Mac)

#### 3. Ships Marked Offline Incorrectly

**Symptoms**: Ships show as offline even when connected

**Solutions**:
- Verify heartbeat is being sent (check replica logs for `💓 Heartbeat`)
- Check Kafka connectivity on replica
- Increase heartbeat timeout threshold if needed

#### 4. Duplicate Conflicts

**Symptoms**: Multiple conflict entries for same document

**Solutions**: This was fixed - the plugin now updates existing unresolved conflicts instead of creating duplicates.

#### 5. Post-Resolution Conflicts

**Symptoms**: After resolving conflict, next sync triggers new conflict

**Solutions**: This was fixed - the plugin now updates the document mapping timestamp after resolution.

### Development Tips

```bash
# Clean restart (Windows)
Remove-Item -Recurse -Force dist, .cache -ErrorAction SilentlyContinue
npm run develop

# Clean restart (Linux/Mac)
rm -rf dist .cache && npm run develop

# Use unique consumer group in development
KAFKA_CONSUMER_GROUP_SUFFIX=dev-$(date +%s) npm run develop
```

### Logs to Monitor

| Log Pattern | Meaning |
|-------------|---------|
| `✅ Kafka producer connected` | Producer ready |
| `✅ Kafka consumer connected` | Consumer ready |
| `📨 Received sync message` | Master received ship update |
| `📥 Received master update` | Replica received master update |
| `✅ Created/Updated/Deleted` | Successful sync operation |
| `⚠️ CONFLICT` | Conflict detected |
| `💓 Heartbeat from` | Ship heartbeat received |

---

## 📝 Database Schema

### Custom Tables (Raw SQL)

```sql
-- sync_queue (Replica only)
CREATE TABLE sync_queue (
  id SERIAL PRIMARY KEY,
  ship_id VARCHAR(255) NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  content_id VARCHAR(255) NOT NULL,
  operation VARCHAR(50) NOT NULL,
  local_version INTEGER DEFAULT 0,
  data JSONB,
  status VARCHAR(50) DEFAULT 'pending',
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  kafka_offset INTEGER,
  synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- conflict_logs (Master only)
CREATE TABLE conflict_logs (
  id SERIAL PRIMARY KEY,
  content_type VARCHAR(255) NOT NULL,
  content_id VARCHAR(255) NOT NULL,
  ship_id VARCHAR(255) NOT NULL,
  ship_version INTEGER,
  master_version INTEGER,
  ship_data JSONB,
  master_data JSONB,
  conflict_type VARCHAR(100),
  resolution_strategy VARCHAR(50),
  resolution_data JSONB,
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Strapi Content Types

- `plugin::offline-sync.document-mapping` - Maps replica ↔ master document IDs
- `plugin::offline-sync.processed-message` - Tracks processed messages (idempotency)
- `plugin::offline-sync.dead-letter` - Failed messages for retry
- `plugin::offline-sync.ship-registry` - Registered ships and their status

---

## 🔐 Security Considerations

1. **Enable Authentication**: Currently routes have `auth: false` for development. Enable authentication before production deployment.

2. **Kafka Security**: Always use SASL authentication and SSL in production.

3. **Sensitive Data**: The plugin automatically strips sensitive fields (passwords, tokens, secrets) before syncing.

4. **Network Security**: Use VPN or private networks for Kafka communication in production.

---

## 📄 License

This plugin is part of the Strapi project and follows the project's license.

---

## 🤝 Support

For issues or questions, contact the development team.

