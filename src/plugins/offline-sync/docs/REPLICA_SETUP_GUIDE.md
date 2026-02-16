# 🚢 Strapi Offline Sync - Replica Setup Guide

**Last Updated:** January 2026  
**Version:** 1.2

This guide will help you set up your system as a **Replica** (Ship) that connects to the Master system for bi-directional data synchronization.

---

## 🏗️ How It Works

```
┌─────────────────────────────────────────────────────────┐
│  MASTER SYSTEM                                          │
│                                                         │
│  ┌──────────────┐         ┌──────────────┐            │
│  │   Strapi     │◄───────►│    Kafka     │            │
│  │   (Master)   │         │  (Docker)    │            │
│  └──────────────┘         └──────┬───────┘            │
│                                  │ Port 9092          │
└──────────────────────────────────┼─────────────────────┘
                                   │
                                   │ You connect here
                                   │
┌──────────────────────────────────┼─────────────────────┐
│  YOUR SYSTEM (Replica)            │                     │
│                                   │                     │
│  ┌──────────────┐                │                     │
│  │   Strapi     │────────────────┘                     │
│  │  (Replica)   │  ← Connects to Master's Kafka        │
│  └──────────────┘                                      │
│                                                         │
│  ✅ NO Kafka needed!                                    │
│  ✅ NO Docker needed (unless you want it for PostgreSQL)│
│  ✅ Just configure KAFKA_BROKERS to point to master     │
└─────────────────────────────────────────────────────────┘
```

**Important:** 
- You don't need to install or run Kafka. Your Strapi will connect directly to the master's Kafka running in Docker.
- You don't need Docker at all (unless you want to run PostgreSQL in Docker, which is optional).
- You only need Node.js and PostgreSQL installed directly on your system.

---

## ⚠️ Critical: Offline Scenarios

### 🎯 PRIMARY USE CASE: Replica Loses Internet Connection

**This is the MAIN scenario this system is designed for!**

**Important:** Master's Kafka is **always online** (stable, running continuously). You test offline scenarios by **disconnecting YOUR internet** on the replica side.

**Scenario:** You're on a ship at sea, WiFi disconnects, network cable unplugged, or you lose internet connection for any reason. **Master stays online** - only you lose connection.

**What Happens:**
- ✅ You **continue working** normally (offline mode)
- ✅ All operations are **queued** in your local `sync_queue` table
- ✅ **Zero data loss** - everything is saved locally in your database
- ✅ You can create, update, delete content normally
- ✅ **Master's Kafka stays online** - but you can't reach it (no internet on your side)

**When Internet Connection is Restored:**
- ✅ Your system **automatically detects** connection is back (checks every 30 seconds)
- ✅ Your system **automatically reconnects** to master's Kafka (no manual steps needed)
- ✅ All queued operations **automatically sync** to master
- ✅ Master receives all your changes that happened while you were offline
- ✅ You also receive any updates from master that happened while you were offline

**This is the PRIMARY use case - ships at sea with intermittent connectivity!**

**To Test:** Simply disconnect your WiFi or unplug your network cable - master's Kafka stays online!

---

### What Happens When Master's Kafka is Down? (Rare Scenario)

**Note:** In normal operation, master's Kafka is **always online**. This scenario is rare and only happens during maintenance.

**If master closes Docker Kafka** (rare - during maintenance):
- ❌ You **cannot** sync to master (no communication channel)
- ✅ You **continue working** normally (offline mode)
- ✅ All operations are **queued** in your local `sync_queue` table
- ✅ **Zero data loss** - everything is saved locally
- ✅ You can create, update, delete content normally

**When master restarts Kafka:**
- ✅ Your system **automatically detects** Kafka is back online
- ✅ Your system **automatically reconnects** (no manual steps needed)
- ✅ All queued operations **automatically sync** to master
- ✅ Master receives all your changes that happened while Kafka was down

**For Testing:** Use internet disconnection on replica side instead - master's Kafka should stay online!

### How Automatic Reconnection Works

The system checks connectivity every 30 seconds (configurable). When Kafka comes back:

1. **Connectivity Monitor** detects Kafka is online
2. **Kafka Producer** automatically reconnects
3. **Sync Service** automatically pushes all queued operations
4. **Master receives** all your changes

**You don't need to do anything - it's fully automatic!**

### What You'll See in Logs

**When Internet Connection is Lost (WiFi disconnected, network down, etc.):**
```
⚠️ Kafka producer connection deferred: Connection timeout
⚠️ Operating in offline mode - operations will be queued
✅ Content created successfully (saved locally)
📦 Operation queued for sync (will sync when connection is restored)
```

**When Internet Connection is Restored:**
```
✅ Kafka producer connected (replica mode)
🔄 Connectivity restored - starting sync
📤 Syncing 5 queued operations...
✅ All operations synced successfully
💓 Heartbeat sent
📥 Received master update: ... (receiving updates from master)
```

**Same behavior when Master's Kafka is down:**
- Same logs as above
- System treats both scenarios the same way

---

## 🌊 Offline Capability (Key Feature!)

**This system is designed for offline scenarios!** When your ship loses internet connection (WiFi disconnected, network cable unplugged, at sea with no signal):

✅ **Continue Working**: Create, update, delete content normally
✅ **Automatic Queueing**: All operations saved locally and queued for sync
✅ **Zero Data Loss**: Everything stored in local database
✅ **Auto-Sync**: When connection restored, all changes sync automatically
✅ **No Manual Steps**: Fully automatic - just wait for connection
✅ **Bi-Directional**: You also receive updates from master when you reconnect
✅ **i18n/Locale Support**: Each language version syncs independently

**How it works:**
- **When offline** (WiFi disconnected, network down, no internet): 
  - Operations stored in `sync_queue` table (status: `pending`)
  - Content saved in your local database
  - You can work normally - no errors, no data loss
  
- **When online** (WiFi reconnected, network restored, internet back):
  - System automatically detects connection (checks every 30 seconds)
  - Automatically reconnects to master's Kafka
  - Automatically pushes all queued operations to master
  - Automatically receives any updates from master
  - Master receives all your changes automatically

**See `OFFLINE_SYNC_EXPLAINED.md` for detailed explanation.**

**Important:** "Offline" means:
- ✅ **PRIMARY:** Your network connection is down (WiFi disconnected, no internet, at sea)
- ✅ **SECONDARY:** Master's Kafka is down/stopped (less common)

**In both cases:**
- You continue working normally
- Operations are queued locally
- Automatic sync happens when connection is restored
- No manual intervention needed!

---

## 📋 Prerequisites

Before you begin, make sure you have:

- ✅ Node.js (v18 or higher)
- ✅ PostgreSQL installed and running (can be installed directly or in Docker - your choice)
- ✅ Git installed
- ✅ Access to the Strapi codebase
- ✅ **Master's IP Address** (you'll receive this from the master administrator)
- ✅ Network connectivity to the master system

**⚠️ IMPORTANT:** 
- ❌ You do **NOT** need Docker (unless you want to run PostgreSQL in Docker)
- ❌ You do **NOT** need to install or run Kafka! The master is running Kafka in Docker, and you will connect to it remotely.
- ✅ You only need Node.js and PostgreSQL (can be installed directly without Docker)

---

## 🔧 Step 1: Get Master Information

**Note:** You don't need to install Kafka - the master is running it in Docker and you'll connect remotely.

### 🌐 Network Options

**Do you need to be on the same WiFi?**

**Answer: NO - You have options:**

1. **Same WiFi** (Easiest):
   - Master IP: `192.168.1.100` (local IP)
   - Works immediately, no extra setup

2. **Different Networks (Internet)**:
   - Master IP: `54.123.45.67` (public IP)
   - Or: `kafka.yourdomain.com` (domain name)
   - Or: `0.tcp.ngrok.io:12345` (ngrok tunnel)
   - Works over internet - perfect for testing with friend far away!

3. **Cloud Hosting**:
   - Master IP: Cloud server's public IP
   - Works from anywhere in the world

**All options work the same way** - just use the correct IP/domain in your `.env` file!

---

You need the following information from the master administrator:

1. **Master's IP Address or Domain** (e.g., `192.168.1.100` or `54.123.45.67` or `kafka.yourdomain.com`)
   - **Same WiFi:** Local IP like `192.168.1.100`
   - **Internet:** Public IP or domain name
   - **ngrok:** ngrok URL like `0.tcp.ngrok.io:12345`
2. **Kafka Port** (usually `9092`)
   - This port is already exposed from the master's Docker container
3. **Unique Ship ID** (e.g., `ship-001`, `ship-atlantic-001`)
   - Choose a unique identifier for your replica system

**Examples:**

**Same WiFi:**
```
Master IP: 192.168.1.100
Kafka Port: 9092
Your Ship ID: ship-001
```

**Internet (Public IP):**
```
Master IP: 54.123.45.67
Kafka Port: 9092
Your Ship ID: ship-001
```

**Internet (ngrok):**
```
Master IP: 0.tcp.ngrok.io:12345
Kafka Port: (included in URL)
Your Ship ID: ship-001
```

**What happens:** Your Strapi instance will connect to the master's Kafka broker running in Docker. You don't need to run Kafka yourself!

---

## 📥 Step 2: Clone and Install

1. **Clone the repository** (if you haven't already):
   ```bash
   git clone <repository-url>
   cd strapi-lastest-master
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

---

## 🗄️ Step 3: Database Setup

**Note:** You can use PostgreSQL installed directly on your system OR run it in Docker - both work fine!

### Option A: PostgreSQL Installed Directly (No Docker)

1. **Create a PostgreSQL database** for your replica:
   ```sql
   CREATE DATABASE ship_replica;
   ```
   
   Or using psql command line:
   ```bash
   psql -U postgres -c "CREATE DATABASE ship_replica;"
   ```

### Option B: PostgreSQL in Docker (Optional)

If you prefer Docker for PostgreSQL:
```bash
docker run --name postgres-replica \
  -e POSTGRES_PASSWORD=your-password \
  -e POSTGRES_DB=ship_replica \
  -p 5432:5432 \
  -d postgres:15
```

**Then update your `.env`** to use `localhost:5432` (Docker exposes PostgreSQL on host port 5432).

**Either way works!** Choose what's easier for you.

2. **Run database migrations** (REQUIRED for offline sync):
   ```bash
   # This creates the sync_queue table needed for offline operations
   psql -U postgres -d ship_replica -f src/plugins/offline-sync/database/migrations/001_create_sync_tables.sql
   
   # Or with password:
   $env:PGPASSWORD='your-password'; psql -h localhost -p 5432 -U postgres -d ship_replica -f src/plugins/offline-sync/database/migrations/001_create_sync_tables.sql
   ```
   
   **Why this is important:** The `sync_queue` table stores all operations when you're offline. Without it, offline sync won't work!

---

## ⚙️ Step 4: Environment Configuration

1. **Copy the example environment file** (if exists):
   ```bash
   cp .env.example .env
   ```

2. **Edit the `.env` file** with the following configuration:

   ```env
   # ============================================
   # Strapi Core Configuration
   # ============================================
   HOST=0.0.0.0
   PORT=1337
   APP_KEYS=your-app-keys-here
   API_TOKEN_SALT=your-api-token-salt-here
   ADMIN_JWT_SECRET=your-admin-jwt-secret-here
   TRANSFER_TOKEN_SALT=your-transfer-token-salt-here
   JWT_SECRET=your-jwt-secret-here

   # ============================================
   # Database Configuration (Replica)
   # ============================================
   DATABASE_CLIENT=postgres
   DATABASE_HOST=localhost
   DATABASE_PORT=5432
   DATABASE_NAME=ship_replica
   DATABASE_USERNAME=postgres
   DATABASE_PASSWORD=your-database-password

   # ============================================
   # Offline Sync - Replica Mode
   # ============================================
   # IMPORTANT: Set mode to 'replica'
   SYNC_MODE=replica
   
   # IMPORTANT: Set your unique ship ID (get this from master admin)
   SYNC_SHIP_ID=ship-001
   
   # ============================================
   # Kafka Configuration
   # ============================================
   # IMPORTANT: Replace with the address from master administrator
   # 
   # If master is using ngrok (for testing over internet):
   # KAFKA_BROKERS=0.tcp.ngrok.io:12345
   # 
   # If master is on same WiFi:
   # KAFKA_BROKERS=192.168.1.100:9092
   # 
   # If master is on cloud/internet:
   # KAFKA_BROKERS=54.123.45.67:9092
   # 
   KAFKA_BROKERS=<MASTER_ADDRESS>:<PORT>
   
   # Note: You don't need to install Kafka - you're connecting to master's Kafka!
   
   # Optional: If master uses SSL/SASL authentication
   # KAFKA_SSL_ENABLED=false
   # KAFKA_SASL_MECHANISM=plain
   # KAFKA_SASL_USERNAME=kafka-user
   # KAFKA_SASL_PASSWORD=kafka-password
   
   # Optional: Custom topic names (usually not needed)
   # KAFKA_TOPIC_SHIP_UPDATES=ship-updates
   # KAFKA_TOPIC_MASTER_UPDATES=master-updates
   
   # ============================================
   # Optional: Sync Settings
   # ============================================
   # SYNC_BATCH_SIZE=100
   # SYNC_RETRY_ATTEMPTS=3
   # SYNC_RETRY_DELAY=5000
   # SYNC_CONNECTIVITY_CHECK_INTERVAL=30000
   ```

3. **Replace the placeholders**:
   - `<MASTER_ADDRESS>:<PORT>` → The address provided by master administrator:
     - **ngrok:** `0.tcp.ngrok.io:12345` (use exactly as provided)
     - **Same WiFi:** `192.168.1.100:9092`
     - **Internet:** `54.123.45.67:9092` or `kafka.yourdomain.com:9092`
   - `ship-001` → Your unique ship ID (provided by master administrator)
   - `your-app-keys-here` → Generate unique keys (see below)
   - `your-database-password` → Your PostgreSQL password

4. **Generate Strapi secrets** (if not already done):
   ```bash
   # Generate random secrets (run these commands and copy the output)
   node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"
   # Run this 5 times for APP_KEYS, API_TOKEN_SALT, ADMIN_JWT_SECRET, TRANSFER_TOKEN_SALT, JWT_SECRET
   ```

---

## 🔍 Step 5: Test Network Connectivity

Before starting Strapi, verify you can connect to the master's Kafka:

### If Master is Using ngrok:

**On Windows:**
```powershell
# Extract hostname and port from ngrok URL
# Example: 0.tcp.ngrok.io:12345
Test-NetConnection -ComputerName 0.tcp.ngrok.io -Port 12345
```

**On Linux/Mac:**
```bash
# Example: 0.tcp.ngrok.io:12345
nc -zv 0.tcp.ngrok.io 12345
```

### If Master is on Same WiFi or Internet:

**On Windows:**
```powershell
Test-NetConnection -ComputerName <MASTER_IP> -Port 9092
```

**On Linux/Mac:**
```bash
telnet <MASTER_IP> 9092
# or
nc -zv <MASTER_IP> 9092
```

**Expected Result:**
- ✅ Connection should succeed
- ✅ If it fails, check:
  - Master's ngrok is running (if using ngrok)
  - Master's firewall settings
  - Network connectivity
  - Correct address/port

---

## 🚀 Step 6: Start the Replica

1. **Start Strapi in development mode**:
   ```bash
   npm run develop
   ```

2. **Watch for these success messages** in the logs:
   ```
   ✅ Kafka producer connected (replica mode)
   ✅ Kafka consumer connected (replica mode)
   📡 Subscribed to topic: master-updates
   💓 Heartbeat sent
   ```

3. **If you see errors**, check the troubleshooting section below.

---

## ✅ Step 7: Verify Connection

### Check 1: Heartbeat is Sending
Look for periodic heartbeat messages in your logs:
```
💓 Heartbeat sent
```

### Check 2: Master Receives Your Ship
Ask the master administrator to check their logs for:
```
💓 Heartbeat from ship-001 - online
[ShipTracker] ✅ New ship registered: ship-001
```

### Check 3: Check Your Status
Visit: `http://localhost:1337/api/offline-sync/status`

You should see:
```json
{
  "mode": "replica",
  "shipId": "ship-001",
  "connected": true,
  "kafka": {
    "producer": true,
    "consumer": true
  }
}
```

---

## 🧪 Step 8: Test Synchronization

### Test 1: Create Content on Replica → Master
1. Create a new content item in your Strapi admin panel
2. Check master logs - should show:
   ```
   📨 Received sync message: ... from ship-001
   ```
3. Master administrator should see the content in their database

### Test 2: Master → Replica Sync
1. Ask master administrator to create content
2. Check your logs - should show:
   ```
   📥 Received master update: ...
   ```
3. Check your database - content should appear automatically

### Test 3: i18n/Locale Sync (Multi-Language)
1. Create content in English (EN) on your replica
2. Check master logs - should show:
   ```
   [Sync] ✅ Created api::article.article [en]: ...
   ```
3. Add Arabic (AR) locale to the same content via the locale dropdown
4. Check master logs - should show:
   ```
   [Sync] 🌐 Adding new locale ar to existing api::article.article
   [Sync] ✅ Added locale ar to api::article.article
   ```
5. Verify on master: "Available in" column should show both EN and AR
6. **Important:** Each locale syncs independently - no conflicts between different languages!

---

## 🧪 Step 9: Test Offline Scenarios

This section shows you how to test offline functionality - a key feature of this system!

### Prerequisites for Testing
- ✅ Replica is running and connected to master
- ✅ **Master's Kafka is running** (and stays running during tests)
- ✅ You can create content in Strapi admin panel

### ⚠️ Important Testing Note

**Master's Kafka should ALWAYS stay online during testing!**

- ✅ **Correct way to test:** Disconnect YOUR internet (WiFi off, network cable unplugged)
- ❌ **Don't test by:** Stopping master's Kafka (master should stay online)
- ✅ Master's Kafka runs continuously - you only disconnect YOUR internet connection

---

### 🎯 Test 1: PRIMARY SCENARIO - Disconnect Internet (WiFi/Network)

**This is the MAIN use case - ship at sea loses internet connection!**

**Purpose:** Verify that operations are queued when you lose internet (WiFi disconnected, network cable unplugged, etc.)

**Steps:**

1. **Check initial status** (while online):
   ```bash
   curl http://localhost:1337/api/offline-sync/status
   ```
   
   Expected response:
   ```json
   {
     "mode": "replica",
     "shipId": "ship-001",
     "connected": true,
     "kafka": {
       "producer": true,
       "consumer": true
     }
   }
   ```

2. **Disconnect your internet connection**:
   - **Option A (Easiest):** Disable WiFi on your computer
   - **Option B:** Unplug network cable
   - **Option C:** Block port 9092 (Windows):
     ```powershell
     netsh advfirewall firewall add rule name="Block Kafka" dir=out action=block remoteport=9092 protocol=TCP
     ```

3. **Wait 30-60 seconds** for connectivity monitor to detect offline status

4. **Check status again** (should show offline):
   ```bash
   curl http://localhost:1337/api/offline-sync/status
   ```
   
   Expected response:
   ```json
   {
     "mode": "replica",
     "shipId": "ship-001",
     "connected": false,
     "kafka": {
       "producer": false,
       "consumer": false
     }
   }
   ```

5. **Create content while offline**:
   - Go to Strapi admin panel
   - Create a new article/content item
   - Save it
   
   **Expected logs:**
   ```
   ⚠️ Kafka producer connection deferred: Connection timeout
   ⚠️ Operating in offline mode - operations will be queued
   ✅ Content created successfully (saved locally)
   📦 Operation queued for sync (will sync when connection is restored)
   ```

6. **Create more content** (create 2-3 items):
   - Create another article
   - Update an existing article
   - Delete an article (if you have one)
   
   **All operations should be queued locally!**

7. **Check sync queue** (should show pending operations):
   ```bash
   curl http://localhost:1337/api/offline-sync/queue/pending
   ```
   
   Expected response:
   ```json
   {
     "pending": 3
   }
   ```

8. **Check detailed queue**:
   ```bash
   curl http://localhost:1337/api/offline-sync/queue
   ```
   
   Should show all queued operations with status `pending`

9. **Verify content is saved locally**:
   - Check Strapi admin panel - your content should be visible
   - Content exists in your local database
   - **This proves offline mode works!**

10. **Reconnect YOUR internet** (Master's Kafka was always online):
    - **Option A:** Re-enable WiFi
    - **Option B:** Plug network cable back in
    - **Option C:** Remove firewall rule:
      ```powershell
      netsh advfirewall firewall delete rule name="Block Kafka"
      ```
    
    **Note:** Master's Kafka was always running - you're just reconnecting your internet!

11. **Wait 30-60 seconds** for automatic reconnection

12. **Watch your logs** - you should see:
    ```
    ✅ Kafka producer connected (replica mode)
    🔄 Connectivity restored - starting sync
    📤 Syncing 3 queued operations...
    ✅ Operation synced successfully
    ✅ Operation synced successfully
    ✅ Operation synced successfully
    ✅ All operations synced successfully
    💓 Heartbeat sent
    📥 Received master update: ... (if master made changes while you were offline)
    ```

13. **Check status** (should show online):
    ```bash
    curl http://localhost:1337/api/offline-sync/status
    ```

14. **Check sync queue** (should be empty):
    ```bash
    curl http://localhost:1337/api/offline-sync/queue/pending
    ```
    
    Expected response:
    ```json
    {
      "pending": 0
    }
    ```

15. **Verify content on master**:
    - Ask master admin to check their database
    - All your content should now be on master!
    - **This proves automatic sync works after internet reconnection!**

---

### Test 3: Extended Offline Period (Internet Disconnected)

**Purpose:** Test that system handles long offline periods correctly (like a ship at sea for hours/days).

**Steps:**

1. **Disconnect internet** (disable WiFi or unplug network cable)

2. **Create multiple content items** over 10-15 minutes:
   - Create 5-10 articles
   - Update some articles
   - Delete some articles
   
   **All should be queued locally!**

3. **Check queue periodically**:
   ```bash
   curl http://localhost:1337/api/offline-sync/queue/pending
   ```
   
   Pending count should increase with each operation

4. **Reconnect internet** (re-enable WiFi or plug cable back in)

5. **Wait for sync** (should happen automatically within 30-60 seconds)

6. **Verify all operations synced**:
   - Check queue: `pending` should be 0
   - Check master database: all content should be there
   - **This proves system handles extended offline periods!**

---

### Test 4: Verify Data Integrity

**Purpose:** Ensure no data is lost during offline/online transitions.

**Steps:**

1. **Create content while online** - note the IDs/titles

2. **Go offline** (disconnect internet - disable WiFi)

3. **Create more content while offline** - note the IDs/titles

4. **Go online** (reconnect internet - enable WiFi)

5. **Verify all content exists**:
   - Check your local database - all content should be there
   - Check master database (ask admin) - all content should be there
   - **All content should be present on both sides!**
   - **No data loss during offline period!**

---

## 📊 Monitoring During Offline Tests

### Real-time Status Check
```bash
# Check connection status
curl http://localhost:1337/api/offline-sync/status

# Check pending operations
curl http://localhost:1337/api/offline-sync/queue/pending

# View all queued operations
curl http://localhost:1337/api/offline-sync/queue
```

### Watch Logs
Keep your terminal open to see real-time status:
- `⚠️ Operating in offline mode` - System detected offline
- `📦 Operation queued` - Content saved locally
- `✅ Kafka producer connected` - Reconnected
- `📤 Syncing X queued operations` - Sync in progress

### Database Check (Advanced)
```sql
-- Check sync_queue table directly
SELECT COUNT(*) FROM sync_queue WHERE status = 'pending';

-- View queued operations
SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at DESC;
```

---

## ✅ Offline Test Checklist

After running tests, verify:

- [ ] System detects offline status automatically
- [ ] Content can be created/updated/deleted while offline
- [ ] Operations are queued in `sync_queue` table
- [ ] No data loss during offline period
- [ ] System automatically detects when Kafka is back
- [ ] System automatically reconnects (no manual steps)
- [ ] All queued operations sync automatically
- [ ] Content appears on master after sync
- [ ] Queue becomes empty after successful sync
- [ ] System works correctly after extended offline periods

---

## 🎯 Expected Behavior Summary

| Scenario | Replica Behavior | Master Behavior |
|----------|-----------------|-----------------|
| **🌊 Internet Disconnected** (PRIMARY) | ✅ Continue working<br>✅ Queue operations<br>✅ Save locally<br>✅ No errors | ❌ No sync received (can't reach replica) |
| **🌊 Internet Reconnected** (PRIMARY) | ✅ Auto-detect connection<br>✅ Auto-reconnect<br>✅ Auto-sync queue<br>✅ Receive master updates | ✅ Receives all queued operations<br>✅ Sends missed updates |
| **Kafka Down** (Secondary) | ✅ Same as internet down | ❌ No sync received |
| **Kafka Back** (Secondary) | ✅ Same as internet back | ✅ Receives all queued operations |

**Key Point:** 
- ✅ **PRIMARY USE CASE:** Replica loses internet (WiFi disconnected, at sea) - system handles it perfectly!
- ✅ **Master's Kafka stays online** - only replica loses internet connection
- ✅ **To test:** Simply disconnect YOUR WiFi/network - master's Kafka stays running!
- ✅ Replica always works locally, regardless of connection status!
- ✅ Automatic sync when connection restored - no manual steps needed!

---

## 🔧 Troubleshooting

### Problem: Cannot Connect to Kafka

**Symptoms:**
```
Failed to connect Kafka producer: Connection timeout
Kafka producer connection deferred: Connection timeout
```

**What This Means:**
- Your system is operating in **offline mode**
- All operations are being **queued locally** (no data loss!)
- When connection is restored (internet back or Kafka back), sync will **automatically resume**

**Common Causes:**
1. **🌊 Internet disconnected** (PRIMARY - WiFi off, network cable unplugged, at sea)
2. **Master's Kafka is down** (Secondary - less common)
3. **Master's ngrok is down** (If using ngrok - master's ngrok terminal closed)
4. **ngrok URL changed** (If using ngrok - master restarted ngrok and got new URL)

**Solutions:**
1. ✅ **Check your internet connection:**
   - Is WiFi enabled?
   - Is network cable connected?
   - Can you access other websites?
   
2. ✅ **If using ngrok, ask master admin to verify:**
   - Is ngrok terminal still open?
   - Did ngrok URL change? (ngrok URL changes when restarted)
   - If URL changed, master needs to:
     1. Update `docker-compose.yml` with new ngrok URL
     2. Restart Kafka
     3. Share new URL with you
   - You need to update your `.env` with new URL and restart Strapi
   
3. ✅ **If internet is fine, ask master admin to verify Kafka is running:**
   ```powershell
   # Master should run this:
   docker ps | findstr kafka
   # Should show Kafka container running
   ```
   
4. ✅ Verify master address is correct (ask master admin to confirm):
   - **If ngrok:** Check ngrok URL matches exactly (e.g., `0.tcp.ngrok.io:12345`)
   - **If local IP:** Check IP address matches (e.g., `192.168.1.100:9092`)
5. ✅ Test network connectivity (Step 5)
6. ✅ **Ask master admin to verify:**
   - Kafka Docker container is running: `docker ps | findstr kafka`
   - If using ngrok: ngrok is running and URL is correct
   - If using local IP: Master's firewall allows port 9092
   - `KAFKA_ADVERTISED_LISTENERS` in master's `docker-compose.yml` uses correct address
7. ✅ Check if you're on the same network as master (only for local IP, not ngrok)
8. ✅ Verify master's Kafka is accessible: Test connection (Step 5)

**Important:** 
- ✅ **PRIMARY SCENARIO:** If your internet is disconnected (WiFi off, at sea), you can continue working normally. Master's Kafka stays online. All operations will sync automatically when YOUR internet is restored!
- ✅ **SECONDARY SCENARIO (Rare):** If master's Kafka is down (during maintenance), you can continue working normally. All operations will sync automatically when Kafka is back online!
- ✅ **For Testing:** Disconnect YOUR internet - master's Kafka should stay online!

---

### Problem: "shipId is required" Error

**Symptoms:**
```
Error: shipId is required when mode is "replica"
```

**Solution:**
- Make sure `SYNC_SHIP_ID` is set in your `.env` file
- Restart Strapi after changing `.env`

---

### Problem: Heartbeat Not Sending

**Symptoms:**
- No `💓 Heartbeat sent` messages in logs
- Master doesn't see your ship

**What This Means:**
- Kafka connection is down (master's Kafka stopped or network issue)
- Your system is operating in offline mode
- Heartbeats will resume automatically when Kafka is back

**Solutions:**
1. ✅ **Check if master's Kafka is running** (ask master admin)
2. ✅ Check Kafka connection (see above)
3. ✅ Verify `SYNC_MODE=replica` in `.env`
4. ✅ Check logs for Kafka connection errors
5. ✅ Restart Strapi (only if configuration changed)

**Note:** Heartbeats will automatically resume when Kafka connection is restored. No manual intervention needed.

---

### Problem: Database Connection Error

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solutions:**
1. ✅ Verify PostgreSQL is running
2. ✅ Check database credentials in `.env`
3. ✅ Verify database exists: `psql -U postgres -l`
4. ✅ Check PostgreSQL is listening: `netstat -an | findstr 5432`

---

### Problem: Content Not Syncing

**Symptoms:**
- Content created on replica doesn't appear on master
- Content created on master doesn't appear on replica

**Possible Causes:**
1. **Master's Kafka is down** (most common)
   - Check: `docker ps | findstr kafka` on master
   - Solution: Ask master admin to start Kafka
   - Your operations are queued and will sync automatically when Kafka is back

2. **Master's ngrok is down** (if using ngrok)
   - Check: Is master's ngrok terminal still open?
   - Solution: Ask master admin to start ngrok: `ngrok tcp 9092`
   - **Important:** If ngrok URL changed, master needs to update `docker-compose.yml` and share new URL with you

3. **Network connectivity issue**
   - Check: Can you reach master's address?
   - **If ngrok:** Test connection to ngrok URL
   - **If local IP:** Test connection to master's IP:9092
   - Solution: Fix network connectivity

4. **Kafka connection not established**
   - Check logs for connection errors
   - Solution: See "Cannot Connect to Kafka" section above

5. **ngrok URL changed** (if using ngrok)
   - Master restarted ngrok and got new URL
   - Solution: Ask master for new URL, update your `.env`, restart Strapi

**Solutions:**
1. ✅ **First, verify master's Kafka is running** (ask master admin)
2. ✅ Check Kafka connection status
3. ✅ Verify both systems are running
4. ✅ Check logs for sync errors
5. ✅ Verify content types are not excluded from sync
6. ✅ Check for conflict errors in logs
7. ✅ Check sync queue: `curl http://localhost:1337/api/offline-sync/queue/pending`

**Important:** If Kafka is down, your content is safely queued locally. It will sync automatically when Kafka is back online.

---

## 📊 Monitoring

### Check Sync Status
```bash
curl http://localhost:1337/api/offline-sync/status
```

**Response includes:**
- `connected`: Whether Kafka is connected
- `kafka.producer`: Producer connection status
- `kafka.consumer`: Consumer connection status

### Check Sync Queue
```bash
curl http://localhost:1337/api/offline-sync/queue
```

**Shows all queued operations** (including pending ones waiting for Kafka)

### Check Pending Operations
```bash
curl http://localhost:1337/api/offline-sync/queue/pending
```

**Shows operations waiting to sync** - if Kafka is down, these will be queued here

**What to look for:**
- If `pending` count > 0: Operations are queued (Kafka might be down)
- When Kafka is back: Pending count will decrease as operations sync

---

## 🔐 Security Notes

1. **Never commit `.env` file** to version control
2. **Use strong passwords** for database
3. **Keep Strapi secrets secure** (APP_KEYS, JWT_SECRET, etc.)
4. **If using SASL**, keep Kafka credentials secure

---

## 📞 Support

If you encounter issues:

1. **Check the logs** for error messages
2. **Verify all configuration** matches this guide
3. **Contact the master administrator** with:
   - Your ship ID
   - Error messages from logs
   - Network connectivity test results

---

## 📝 Quick Reference

### Important Environment Variables

| Variable | Value | Example |
|----------|-------|---------|
| `SYNC_MODE` | `replica` | `replica` |
| `SYNC_SHIP_ID` | Your unique ID | `ship-001` |
| `KAFKA_BROKERS` | Master IP:Port | `192.168.1.100:9092` |
| `DATABASE_NAME` | Your DB name | `ship_replica` |

### Key Log Messages

| Message | Meaning |
|---------|---------|
| `✅ Kafka producer connected` | Successfully connected to Kafka |
| `✅ Kafka consumer connected` | Successfully subscribed to topics |
| `💓 Heartbeat sent` | Periodic heartbeat to master |
| `📥 Received master update` | Received content from master |
| `📨 Received sync message` | Sent content to master |
| `⚠️ Operating in offline mode` | System detected Kafka is down |
| `📦 Operation queued` | Content saved locally, waiting for sync |
| `🔄 Connectivity restored` | Kafka connection restored |
| `📤 Syncing X queued operations` | Automatic sync in progress |
| `🌐 Adding new locale ar` | New locale being added to existing doc |
| `✅ Added locale ar` | Locale successfully added |

### Quick Testing Commands

```bash
# Check connection status
curl http://localhost:1337/api/offline-sync/status

# Check pending operations count
curl http://localhost:1337/api/offline-sync/queue/pending

# View all queued operations
curl http://localhost:1337/api/offline-sync/queue

# Manual sync trigger (if needed)
curl -X POST http://localhost:1337/api/offline-sync/push
```

---

## ✅ Setup Checklist

Before contacting support, verify:

- [ ] **Node.js (v18+)** is installed
- [ ] **PostgreSQL is installed and running** (directly or in Docker - your choice)
- [ ] Database `ship_replica` is created
- [ ] `.env` file is configured correctly
- [ ] `SYNC_MODE=replica` is set
- [ ] `SYNC_SHIP_ID` is set (unique ID)
- [ ] `KAFKA_BROKERS` points to master IP (e.g., `192.168.1.100:9092`)
- [ ] **Master's Kafka is running** (ask master admin to verify)
- [ ] Network connectivity test passes (can reach master's IP:9092)
- [ ] Strapi starts without errors
- [ ] Kafka producer/consumer connect successfully (connecting to master's Kafka)
- [ ] Heartbeat messages appear in logs
- [ ] **Database migration run** (creates `sync_queue` table for offline operations)

**Remember:** 
- ❌ You don't need Docker (unless you want it for PostgreSQL)
- ❌ You don't need Kafka installed - you're connecting to the master's Kafka!
- ✅ You only need Node.js and PostgreSQL (can be installed directly)
- ✅ **Offline capability is built-in** - you can work without internet, changes will sync automatically when connection is restored!
- ✅ **i18n/Locale support** - create content in multiple languages, each syncs independently

---

**Good luck with your setup! 🚀**

