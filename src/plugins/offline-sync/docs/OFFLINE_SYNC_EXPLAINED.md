# 🌊 How Offline Sync Handles Network Disconnections

**Last Updated:** January 2026  
**Version:** 1.2

This document explains how the Offline Sync plugin handles scenarios when ships are at sea with **no internet connection** or **intermittent connectivity**.

---

## 🎯 The Problem

**Scenario:** Ship is at sea, internet connection is lost or unreliable.

**Requirements:**
- ✅ Ship must continue working **locally** (create, update, delete content)
- ✅ All changes must be **saved locally** and **queued for sync**
- ✅ When connection is restored, changes must **automatically sync** to master
- ✅ No data loss during offline periods
- ✅ Conflict resolution when same content is modified on both master and ship
- ✅ **i18n/Locale support** - different locales sync independently

---

## 🔧 How It Works: Offline-First Architecture

### 1. **Local Database Storage (Always Available)**

When a ship is offline, it uses its **local PostgreSQL database** to store all content and operations.

```
┌─────────────────────────────────────────┐
│  SHIP AT SEA (Offline)                  │
│                                         │
│  ┌──────────────┐                      │
│  │   Strapi     │                      │
│  │  (Replica)   │                      │
│  └──────┬───────┘                      │
│         │                               │
│         ▼                               │
│  ┌──────────────┐                      │
│  │   Local DB   │  ← All data stored   │
│  │ (PostgreSQL) │     locally          │
│  └──────────────┘                      │
│         │                               │
│         ▼                               │
│  ┌──────────────┐                      │
│  │  sync_queue  │  ← Operations queued │
│  │   (Table)    │     for later sync   │
│  └──────────────┘                      │
└─────────────────────────────────────────┘
```

**Key Point:** Ship continues working normally even when offline!

---

### 2. **Sync Queue: The Heart of Offline Sync**

Every time content is created, updated, or deleted on the ship, the operation is **automatically queued** in the `sync_queue` table.

#### Example: Ship Creates Content While Offline

```sql
-- User creates a new article on ship
INSERT INTO articles (title, content, ...) VALUES (...);

-- Plugin automatically queues this operation
INSERT INTO sync_queue (
  ship_id,
  content_type,
  content_id,
  operation,        -- 'create'
  local_version,    -- 1
  data,             -- Full article data (JSONB)
  status            -- 'pending'
) VALUES (...);
```

**Status Flow:**
- `pending` → Operation is waiting to be synced
- `syncing` → Currently being sent to Kafka
- `synced` → Successfully synced to master
- `failed` → Failed to sync (will retry)

---

### 3. **Connectivity Monitoring**

The system **continuously monitors** network connectivity every 30 seconds (configurable).

```typescript
// Checks every 30 seconds
connectivityMonitor.checkConnectivity()
  → Tests Kafka connection
  → Returns: { isOnline: true/false }
```

**When Offline:**
- Operations are queued but **not sent**
- System logs: `[InstantSync] Offline - X items queued`
- Ship continues working normally

**When Online:**
- System detects connection restored
- Automatically starts pushing queued operations
- Logs: `[InstantSync] 🔄 Pushing X items to Kafka...`

---

### 4. **Automatic Sync When Connection Restored**

When the ship regains internet connection:

```
┌─────────────────────────────────────────┐
│  1. Connectivity Monitor Detects       │
│     Connection Restored                 │
│     ✅ isOnline = true                  │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  2. Automatic Push Triggered            │
│     executePush() called                │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  3. Fetch Pending Operations            │
│     SELECT * FROM sync_queue            │
│     WHERE status = 'pending'            │
│     ORDER BY created_at ASC            │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  4. Send Each Operation to Kafka        │
│     For each operation:                 │
│     - Send to Kafka topic               │
│     - Mark as 'synced'                  │
│     - Master receives and processes     │
└─────────────────────────────────────────┘
```

**Example Log Output:**
```
[ConnectivityMonitor] Connection restored ✅
[InstantSync] 🔄 Pushing 15 items to Kafka...
[InstantSync] ✅ Pushed 15 items, 0 failed
```

---

## 📊 Complete Flow: Ship Goes Offline → Online

### Phase 1: Ship Goes Offline

```
Time: 10:00 AM - Ship loses internet connection

User Actions:
1. Creates Article A
2. Updates Article B  
3. Deletes Article C

What Happens:
✅ All operations saved to local database
✅ All operations queued in sync_queue table
✅ Status: 'pending' (waiting for connection)
✅ Ship continues working normally
```

**Database State:**
```sql
-- sync_queue table
id | ship_id | operation | content_type | content_id | status
1  | ship-001| create    | article      | 123        | pending
2  | ship-001| update    | article      | 456        | pending
3  | ship-001| delete    | article      | 789        | pending
```

---

### Phase 2: Ship Remains Offline

```
Time: 10:00 AM - 2:00 PM (4 hours offline)

User Actions:
- Creates 10 more articles
- Updates 5 articles
- Deletes 2 articles

What Happens:
✅ All operations continue to be queued
✅ Connectivity monitor detects offline (every 30s)
✅ Logs: "[InstantSync] Offline - 17 items queued"
✅ No data loss - everything stored locally
```

**Database State:**
```sql
-- sync_queue table now has 17 pending operations
-- All with status = 'pending'
```

---

### Phase 3: Connection Restored

```
Time: 2:00 PM - Ship regains internet connection

What Happens Automatically:
1. Connectivity monitor detects connection (within 30 seconds)
2. System triggers automatic push
3. All 17 queued operations are sent to Kafka
4. Master receives and processes all operations
5. Operations marked as 'synced' in sync_queue
```

**Log Output:**
```
[ConnectivityMonitor] Connection restored ✅
[InstantSync] 🔄 Pushing 17 items to Kafka...
[KafkaProducer] ✅ Sent operation 1/17
[KafkaProducer] ✅ Sent operation 2/17
...
[InstantSync] ✅ Pushed 17 items, 0 failed
```

**Database State After Sync:**
```sql
-- sync_queue table
id | status   | synced_at
1  | synced   | 2024-01-15 14:00:15
2  | synced   | 2024-01-15 14:00:16
...
17 | synced   | 2024-01-15 14:00:32
```

---

## 🔄 Bi-Directional Sync

### Ship → Master (When Ship Goes Online)

When ship regains connection:
- ✅ All pending operations automatically pushed
- ✅ Master receives updates via Kafka
- ✅ Master applies changes to its database

### Master → Ship (When Ship Goes Online)

When ship regains connection:
- ✅ Kafka Consumer automatically reconnects
- ✅ Receives all missed updates from `master-updates` topic
- ✅ Applies changes to local database
- ✅ No manual intervention needed

**Note:** Kafka retains messages even when ship is offline, so ship receives all missed updates when reconnecting.

---

## 🛡️ Data Safety Features

### 1. **No Data Loss**
- All operations stored in `sync_queue` table
- Even if Strapi crashes, queue persists in database
- Operations retry automatically when connection restored

### 2. **Version Management**
- Each operation has a `local_version` number
- Prevents conflicts when same content modified on both sides
- Master tracks versions to detect conflicts

### 3. **Conflict Detection & Resolution** (See detailed section below)
- Automatic conflict detection using timestamps
- Conflicts logged in `conflict_logs` table
- Admin can resolve with 3 strategies: keep-ship, keep-master, or merge
- System prevents data corruption and data loss

### 4. **Retry Mechanism**
- Failed operations marked as `failed`
- Automatically retried on next sync attempt
- Configurable retry attempts (default: 3)

---

## ⚙️ Configuration Options

### Connectivity Check Interval

```env
# Check connectivity every 30 seconds (default)
SYNC_CONNECTIVITY_CHECK_INTERVAL=30000
```

**Lower value** = Faster detection of connection restored
**Higher value** = Less network overhead

### Batch Size

```env
# Send 100 operations at a time (default)
SYNC_BATCH_SIZE=100
```

**Larger batch** = Faster sync but more memory usage
**Smaller batch** = Slower sync but less memory

### Retry Settings

```env
# Retry failed operations 3 times (default)
SYNC_RETRY_ATTEMPTS=3

# Wait 5 seconds between retries (default)
SYNC_RETRY_DELAY=5000
```

---

## 📈 Monitoring & Status

### Check Pending Operations

```bash
# API endpoint
GET /api/offline-sync/queue/pending

# Response
{
  "pending": 17,
  "syncing": 0,
  "failed": 0
}
```

### Check Sync Status

```bash
# API endpoint
GET /api/offline-sync/status

# Response
{
  "mode": "replica",
  "shipId": "ship-001",
  "connected": false,  // Currently offline
  "kafka": {
    "producer": false,
    "consumer": false
  },
  "pendingOperations": 17
}
```

---

## 🎬 Real-World Example

### Scenario: Ship at Sea for 1 Week

**Day 1-7: Ship Offline**
- Crew creates 50 articles
- Updates 30 articles
- Deletes 10 articles
- **Total: 90 operations queued**

**Day 8: Ship Returns to Port (Internet Available)**
- Within 30 seconds: Connection detected
- Automatic sync starts
- All 90 operations sent to master
- Master receives and processes all updates
- **Total sync time: ~2 minutes**

**Result:**
- ✅ Zero data loss
- ✅ All changes synced automatically
- ✅ No manual intervention needed
- ✅ Master has complete picture of ship's activities

---

## ⚔️ Conflict Detection & Resolution

### What is a Conflict?

A conflict occurs when the **same document AND same locale** is modified on **both master and ship** at different times, and the ship tries to sync its changes.

**Example Scenario 1: Same Locale Conflict ⚠️**
```
Day 1: Ship syncs Article #123 [EN] (title: "Weather Report")
Day 2: Ship goes offline
Day 3: Master admin updates Article #123 [EN] (title: "Updated Weather Report")
Day 4: Ship crew updates Article #123 [EN] (title: "Ship Weather Report")
Day 5: Ship comes online and tries to sync
→ CONFLICT DETECTED! ⚠️ (Same locale modified on both sides)
```

**Example Scenario 2: Different Locales - NO Conflict ✅**
```
Day 1: Ship syncs Article #123 [EN] (title: "Weather Report")
Day 2: Ship goes offline
Day 3: Master admin adds Article #123 [AR] (title: "تقرير الطقس")
Day 4: Ship crew updates Article #123 [EN] (title: "Ship Weather Report")
Day 5: Ship comes online and tries to sync
→ NO CONFLICT! ✅ (Different locales - they sync independently)
```

**Example Scenario 3: Adding New Locale - NO Conflict ✅**
```
Day 1: Master has Article #123 [EN] only
Day 2: Ship creates Article #123 [AR] while offline
Day 5: Ship comes online and tries to sync
→ NO CONFLICT! ✅ (AR is a NEW locale that doesn't exist on master)
```

---

### How Conflict Detection Works

The system uses **timestamp + source-based conflict detection** with **i18n/locale awareness**:

```
┌─────────────────────────────────────────┐
│  Ship Sends Update                      │
│  (Article #123, locale: AR)             │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  1. Get Document Mapping                 │
│     - Find when ship last synced        │
│     - lastSyncedAt = mapping.updatedAt   │
│     - lastSyncedBy = mapping.lastSyncedBy│
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  2. Get Master Document (WITH LOCALE!)  │
│     - Get master doc for SAME locale    │
│     - masterUpdatedAt = doc.updatedAt   │
│     - If locale doesn't exist → NEW!    │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  3. New Locale Check (NO CONFLICT)      │
│     IF locale exists in message AND     │
│        master doc for locale is NULL    │
│     THEN → NEW LOCALE! Apply directly   │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  4. Check Master Edit Log               │
│     - Did master admin edit directly?   │
│     - editedBy = 'master-admin'?        │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  5. Compare Timestamps + Source         │
│     IF masterUpdatedAt > lastSyncedAt   │
│        AND (different ship modified     │
│             OR master admin edited)     │
│     THEN → CONFLICT!                    │
│     ELSE → No conflict, apply update    │
└─────────────────────────────────────────┘
```

**Key Logic:**
```typescript
// NEW: Check for new locale (no conflict possible)
const isNewLocale = message.locale && !masterDoc;
if (isNewLocale) {
  // Apply directly - adding new locale doesn't conflict
  return applyUpdate();
}

// Conflict detected if:
// 1. Master modified AFTER last sync by DIFFERENT source
// 2. OR Master admin directly edited
const masterModifiedAfterSync = masterUpdatedAt > lastSyncedAt;
const differentSourceModified = lastSyncedBy !== shipId;
const masterAdminEdited = masterEditLog.editedBy === 'master-admin';

const hasConflict = (masterModifiedAfterSync && differentSourceModified) || masterAdminEdited;
```

**Why This Works:**
- **Locale-aware:** EN and AR versions are checked independently
- **New locale:** Adding AR to EN-only document = NO conflict
- **Multi-ship aware:** Ship A editing after Ship B = CONFLICT
- **Admin tracking:** Master admin edits are tracked separately
- System prevents data loss by detecting conflicts automatically

---

### Conflict Detection Flow

```
┌─────────────────────────────────────────────────────────┐
│  Ship Update Arrives at Master                          │
│  (Article #123, operation: update)                      │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  Get Document Mapping                                   │
│  - shipId: ship-001                                     │
│  - contentType: article                                  │
│  - contentId: 123                                       │
│  - lastSyncedAt: 2024-01-10 10:00:00                    │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  Get Master Document                                    │
│  - masterUpdatedAt: 2024-01-12 14:30:00                 │
│  (Master was updated AFTER ship's last sync!)          │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  Compare: masterUpdatedAt > lastSyncedAt?              │
│  2024-01-12 14:30:00 > 2024-01-10 10:00:00             │
│  ✅ YES → CONFLICT DETECTED!                            │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  Actions Taken:                                         │
│  1. Log conflict in conflict_logs table               │
│  2. Store both versions (ship_data + master_data)      │
│  3. Send conflict notification to ship                  │
│  4. DO NOT apply ship's update (prevents data loss)    │
│  5. Wait for admin resolution                           │
└─────────────────────────────────────────────────────────┘
```

---

### Conflict Logging

When a conflict is detected, it's logged in the `conflict_logs` table:

```sql
INSERT INTO conflict_logs (
  content_type,        -- 'article'
  content_id,         -- '123'
  ship_id,            -- 'ship-001'
  ship_data,          -- Ship's version (JSONB)
  master_data,        -- Master's version (JSONB)
  conflict_type,      -- 'concurrent-edit' OR 'master-admin-edit'
  resolved_at         -- NULL (unresolved)
) VALUES (...);

-- conflict_type indicates the SOURCE of the conflict:
-- 'concurrent-edit': Another ship modified the same locale
-- 'master-admin-edit': Master admin directly edited via admin panel
```

**Both versions are preserved:**
- `ship_data`: What ship tried to update
- `master_data`: What master currently has
- Admin can compare both and decide

---

### Conflict Notification to Ship

When master detects a conflict, it sends a notification back to the ship:

```json
{
  "operation": "conflict-rejected",
  "contentType": "article",
  "contentId": "123",
  "conflictId": 42,
  "reason": "Master was edited after last sync from this ship",
  "masterData": { ... },
  "shipData": { ... }
}
```

**Ship's Response:**
- Marks the operation in `sync_queue` as `status: 'conflict'`
- Logs warning: `⚠️ CONFLICT NOTIFICATION received from master`
- Waits for admin resolution on master side

---

### Conflict Resolution Strategies

Master admin can resolve conflicts using **3 strategies**:

#### Strategy 1: **Keep Ship** (`keep-ship`)

**When to use:** Ship's changes are more important/accurate

**What happens:**
- Ship's data replaces master's data
- Master document updated with ship's version
- Document published
- Mapping timestamp updated
- Conflict marked as resolved

**Example:**
```json
POST /api/offline-sync/conflicts/42/resolve
{
  "strategy": "keep-ship"
}
```

**Result:** Master gets ship's version of Article #123

---

#### Strategy 2: **Keep Master** (`keep-master`)

**When to use:** Master's changes are correct, ship's should be discarded

**What happens:**
- Master's data stays as-is
- Ship's update is rejected
- Document published (if not already)
- Mapping timestamp updated
- Conflict marked as resolved

**Example:**
```json
POST /api/offline-sync/conflicts/42/resolve
{
  "strategy": "keep-master"
}
```

**Result:** Master keeps its version, ship's changes discarded

---

#### Strategy 3: **Merge** (`merge`)

**When to use:** Both versions have valuable changes, need to combine

**What happens:**
- Admin manually merges both versions
- Provides merged data
- Master document updated with merged version
- Document published
- Mapping timestamp updated
- Conflict marked as resolved

**Example:**
```json
POST /api/offline-sync/conflicts/42/resolve
{
  "strategy": "merge",
  "mergeData": {
    "title": "Merged Weather Report",
    "content": "Combined content from both versions...",
    "author": "Admin",
    "updatedAt": "2024-01-15T10:00:00Z"
  }
}
```

**Result:** Master gets manually merged version combining both changes

---

### Complete Conflict Resolution Flow

```
┌─────────────────────────────────────────────────────────┐
│  1. Conflict Detected                                    │
│     - Logged in conflict_logs table                     │
│     - Status: unresolved                                │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  2. Admin Reviews Conflict                              │
│     GET /api/offline-sync/conflicts                     │
│     - See list of all unresolved conflicts              │
│     - Compare ship_data vs master_data                  │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  3. Admin Chooses Resolution Strategy                   │
│     - keep-ship: Use ship's version                     │
│     - keep-master: Keep master's version                │
│     - merge: Manually combine both                      │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  4. Resolve Conflict                                    │
│     POST /api/offline-sync/conflicts/42/resolve        │
│     { "strategy": "keep-ship" }                         │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  5. System Applies Resolution                           │
│     - Updates master document                            │
│     - Updates mapping timestamp                         │
│     - Marks conflict as resolved                        │
│     - Future syncs won't see conflict                    │
└─────────────────────────────────────────────────────────┘
```

---

### Conflict Prevention

The system **prevents conflicts** from happening again after resolution:

**After Resolution:**
- Mapping timestamp is updated (`mapping.updatedAt = now()`)
- Next sync from ship compares against new timestamp
- If ship syncs again, it won't conflict (unless master edits again)

**Example:**
```
Conflict resolved: keep-ship
→ mapping.updatedAt = 2024-01-15 10:00:00

Ship syncs again later:
→ lastSyncedAt = 2024-01-15 10:00:00
→ masterUpdatedAt = 2024-01-15 10:00:00
→ No conflict! (timestamps match)
```

---

### Real-World Conflict Example

**Scenario:**
```
Day 1 (10:00 AM): Ship syncs Article #100
                  Master: "Weather Report - Sunny"
                  Mapping updated: 2024-01-10 10:00:00

Day 2: Ship goes offline

Day 3 (2:00 PM): Master admin updates Article #100
                 Master: "Weather Report - Rainy"
                 Master updatedAt: 2024-01-12 14:00:00

Day 4 (9:00 AM): Ship crew updates Article #100 (offline)
                 Ship: "Weather Report - Stormy"
                 Queued for sync

Day 5 (10:00 AM): Ship comes online, syncs Article #100
                  Master receives update
                  
                  Conflict Detection:
                  - lastSyncedAt: 2024-01-10 10:00:00
                  - masterUpdatedAt: 2024-01-12 14:00:00
                  - 14:00:00 > 10:00:00 → CONFLICT! ⚠️
                  
                  Actions:
                  - Conflict logged (#42)
                  - Ship data: "Stormy"
                  - Master data: "Rainy"
                  - Ship notified
                  - Update NOT applied

Day 6: Admin reviews conflict #42
       - Sees both versions
       - Decides: keep-ship (ship's version is more recent)
       
       Resolution:
       POST /api/offline-sync/conflicts/42/resolve
       { "strategy": "keep-ship" }
       
       Result:
       - Master updated: "Weather Report - Stormy"
       - Conflict resolved
       - Mapping timestamp updated
       - Future syncs won't conflict
```

---

### Conflict API Endpoints

#### List All Conflicts
```bash
GET /api/offline-sync/conflicts

Response:
[
  {
    "id": 42,
    "contentType": "article",
    "contentId": "123",
    "shipId": "ship-001",
    "shipData": { "title": "Ship Version" },
    "masterData": { "title": "Master Version" },
    "conflictType": "concurrent-edit",
    "createdAt": "2024-01-15T10:00:00Z",
    "resolvedAt": null
  }
]
```

#### Get Specific Conflict
```bash
GET /api/offline-sync/conflicts/42

Response:
{
  "id": 42,
  "contentType": "article",
  "contentId": "123",
  "shipId": "ship-001",
  "shipData": { ... },
  "masterData": { ... },
  ...
}
```

#### Resolve Conflict
```bash
POST /api/offline-sync/conflicts/42/resolve
Content-Type: application/json

{
  "strategy": "keep-ship"  // or "keep-master" or "merge"
}

# For merge strategy:
{
  "strategy": "merge",
  "mergeData": {
    "title": "Merged Title",
    "content": "Merged content..."
  }
}
```

---

### Conflict Statistics

Monitor conflicts to understand sync health:

```bash
# Check unresolved conflicts count
GET /api/offline-sync/conflicts

# Filter by ship
GET /api/offline-sync/conflicts?shipId=ship-001

# Filter by content type
GET /api/offline-sync/conflicts?contentType=article
```

**Healthy System:**
- Low conflict rate (< 5% of updates)
- Conflicts resolved quickly (< 24 hours)
- Most conflicts resolved with `keep-ship` or `keep-master`

**Warning Signs:**
- High conflict rate (> 10%)
- Many conflicts unresolved for days
- Frequent `merge` resolutions needed (indicates workflow issues)

---

### Best Practices for Conflict Management

1. **Monitor Conflicts Regularly**
   - Check `/api/offline-sync/conflicts` daily
   - Resolve conflicts promptly

2. **Understand Your Workflow**
   - If conflicts are frequent, consider:
     - Assigning content ownership (ship vs master)
     - Using different content types for different sources
     - Implementing workflow rules

3. **Use Appropriate Strategy**
   - `keep-ship`: Ship has authoritative data (e.g., sensor readings)
   - `keep-master`: Master has authoritative data (e.g., company policies)
   - `merge`: Both have valuable changes (rare, requires manual work)

4. **Document Resolution Decisions**
   - Note why you chose a strategy
   - Helps establish patterns for future conflicts

---

## ✅ Summary: How It Solves the Problem

| Problem | Solution |
|---------|----------|
| **No internet at sea** | ✅ Local database stores everything |
| **Operations during offline** | ✅ All queued in `sync_queue` table |
| **Data loss** | ✅ Database persistence, no data lost |
| **Manual sync needed** | ✅ Automatic sync when connection restored |
| **Missed updates from master** | ✅ Kafka retains messages, ship receives on reconnect |
| **Conflicts** | ✅ Automatic detection + 3 resolution strategies (keep-ship, keep-master, merge) |
| **Connection detection** | ✅ Automatic monitoring every 30 seconds |
| **Multi-language content** | ✅ Each locale syncs independently (i18n support) |
| **New locale added** | ✅ Automatically applied without conflict checks |

---

## 🔍 Technical Details

### Database Tables Used

1. **sync_queue** (Replica)
   - Stores pending operations
   - Tracks sync status
   - Persists across restarts

2. **conflict_logs** (Master)
   - Stores detected conflicts
   - Admin resolution interface

3. **ship_registries** (Master)
   - Tracks ship connectivity
   - Last seen timestamps

### Key Services

1. **sync-queue**: Manages operation queue
2. **connectivity-monitor**: Detects online/offline status
3. **sync-service**: Handles push/pull operations
4. **kafka-producer**: Sends messages to Kafka
5. **kafka-consumer**: Receives messages from Kafka

---

## 🚀 Best Practices

1. **Monitor Pending Queue**
   - Check regularly: `GET /api/offline-sync/queue/pending`
   - Alert if queue grows too large

2. **Database Backups**
   - Regular backups of `sync_queue` table
   - Ensures no data loss even if database crashes

3. **Network Monitoring**
   - Monitor connectivity check logs
   - Track offline duration

4. **Conflict Resolution**
   - Review `conflict_logs` regularly
   - Resolve conflicts promptly

---

**The system is designed specifically for maritime/offline scenarios! 🚢**

---

## 🎯 Conflict Resolution Summary

**How Conflicts Are Solved:**

1. **Automatic Detection** ✅
   - Timestamp + source-based comparison
   - Detects when master modified after ship's last sync
   - Locale-aware: only same locale changes can conflict
   - Prevents data loss automatically

2. **New Locale Detection** ✅
   - Adding a new locale (e.g., AR to EN-only doc) = NO conflict
   - System detects when locale doesn't exist on master
   - Applies new locale directly without conflict checks

3. **Safe Handling** ✅
   - Both versions preserved in database
   - Ship's update NOT applied (prevents overwrite)
   - Conflict logged for admin review
   - Conflict type tracked: `concurrent-edit` vs `master-admin-edit`

4. **Flexible Resolution** ✅
   - 3 strategies: keep-ship, keep-master, merge
   - Admin decides based on business rules
   - System applies resolution automatically

5. **Prevention** ✅
   - Mapping timestamp updated after resolution
   - `lastSyncedBy` tracks who made last sync
   - Future syncs won't conflict (unless master edits again)
   - Multi-ship aware: different ships tracked separately

**Result:** Zero data loss, zero corruption, locale-aware, flexible conflict handling! 🛡️

---

## 🌐 i18n/Locale Sync Summary

**How Locales Are Handled:**

| Scenario | Result | Why |
|----------|--------|-----|
| Ship updates EN, master has only EN | ✅ Normal sync | Same locale |
| Ship adds AR, master has only EN | ✅ AR added directly | New locale, no conflict |
| Ship updates EN, master admin updated AR | ✅ Both sync | Different locales, independent |
| Ship updates EN, master admin updated EN | ⚠️ CONFLICT | Same locale, both modified |
| Ship updates AR, other ship updated AR | ⚠️ CONFLICT | Same locale, different ships |

**Key Principle:** Each locale version is treated as an independent sync unit. Only modifications to the **same locale** can cause conflicts.

