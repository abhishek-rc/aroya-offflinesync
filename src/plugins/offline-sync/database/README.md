# 🗄️ Offline Sync Plugin - Database Setup

This folder contains the database migration script required for the Offline Sync plugin.

## 📋 Required Tables

| Table | Purpose |
|-------|---------|
| `sync_queue` | Stores pending sync operations (used by Replica) |
| `conflict_logs` | Stores detected conflicts for admin resolution (used by Master) |

> **Note**: Run this migration on **BOTH** Master and Replica databases.

---

## 🚀 Run Migration

### Command

```bash
psql -U <username> -d <database> -f src/plugins/offline-sync/database/migrations/001_create_sync_tables.sql
```

### Examples

**Master:**
```bash
psql -U strapi -d strapi_master -f src/plugins/offline-sync/database/migrations/001_create_sync_tables.sql
```

**Replica:**
```bash
psql -U strapi -d strapi_replica -f src/plugins/offline-sync/database/migrations/001_create_sync_tables.sql
```

**With password:**
```bash
PGPASSWORD=your_password psql -h localhost -U strapi -d strapi_master -f src/plugins/offline-sync/database/migrations/001_create_sync_tables.sql
```

**With connection string:**
```bash
psql "postgresql://strapi:password@localhost:5432/strapi_master" -f src/plugins/offline-sync/database/migrations/001_create_sync_tables.sql
```

**Docker:**
```bash
docker exec -i postgres_container psql -U strapi -d strapi_master < src/plugins/offline-sync/database/migrations/001_create_sync_tables.sql
```

---

## ✅ Verify Installation

```bash
psql -U strapi -d strapi_master -c "\dt sync_queue; \dt conflict_logs;"
```

**Expected output:**
```
          List of relations
 Schema |     Name      | Type  | Owner
--------+---------------+-------+--------
 public | sync_queue    | table | strapi
 public | conflict_logs | table | strapi
```

---

## 📊 Table Schemas

### sync_queue

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `ship_id` | VARCHAR(255) | Ship identifier |
| `content_type` | VARCHAR(255) | Strapi content type |
| `content_id` | VARCHAR(255) | Document ID |
| `operation` | VARCHAR(50) | `create`, `update`, `delete` |
| `local_version` | INTEGER | Local version number |
| `data` | JSONB | Document data |
| `status` | VARCHAR(50) | `pending`, `syncing`, `pushed`, `synced`, `failed` |
| `error_message` | TEXT | Error details if failed |
| `retry_count` | INTEGER | Retry attempts |
| `synced_at` | TIMESTAMP | When sync completed |
| `created_at` | TIMESTAMP | When queued |

### conflict_logs

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `content_type` | VARCHAR(255) | Strapi content type |
| `content_id` | VARCHAR(255) | Document ID |
| `ship_id` | VARCHAR(255) | Ship that caused conflict |
| `ship_data` | JSONB | Ship's document data |
| `master_data` | JSONB | Master's document data |
| `resolution_strategy` | VARCHAR(50) | `keep-ship`, `keep-master`, `merge` |
| `resolved_at` | TIMESTAMP | When resolved |
| `resolved_by` | VARCHAR(255) | Who resolved it |
| `created_at` | TIMESTAMP | When detected |

---

## 🔄 Rollback (if needed)

```sql
DROP TABLE IF EXISTS sync_queue CASCADE;
DROP TABLE IF EXISTS conflict_logs CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
```

---

## 📌 Notes

- **Run before starting Strapi** for the first time
- **Safe to re-run** - uses `IF NOT EXISTS`
- **Run on both** Master and Replica databases
