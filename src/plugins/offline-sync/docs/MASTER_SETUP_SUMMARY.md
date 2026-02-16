# 🎯 Master Setup Summary (For Your Reference)

**Last Updated:** January 2026  
**Version:** 1.2

Quick reference for setting up your system as Master.

## 🌐 Network Requirements

**Do master and replica need to be on the same WiFi?**

**Answer:**
- ✅ **Same WiFi (Easiest):** Works perfectly, no extra configuration needed
- ✅ **Different Networks (Internet):** Also works! Use public IP, ngrok, or cloud hosting
- ✅ **Production:** Ships connect over internet (not same network)

**Options:**
1. **🌐 ngrok (RECOMMENDED for Testing with Friend Far Away)** - Easiest way to test over internet
2. **Same WiFi** - Easiest for local testing
3. **Internet with Public IP** - Master has public IP, ships connect over internet
4. **Cloud Hosting** - Deploy Kafka on cloud, ships connect over internet

**💡 Quick Recommendation:**
- **Testing with friend far away?** → Use **ngrok** (Option A below) - No router config needed!
- **Testing on same WiFi?** → Use **Same WiFi** (Option B below) - Simple local IP
- **Production deployment?** → See **[PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)**

**⚠️ For Production Deployment:** See **[PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)** for deploying with ships connecting over the internet.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  YOUR SYSTEM (Master)                                   │
│                                                         │
│  ┌──────────────┐         ┌──────────────┐            │
│  │   Strapi     │◄───────►│    Kafka     │            │
│  │   (Master)   │         │  (Docker)    │            │
│  └──────────────┘         └──────┬───────┘            │
│                                  │ Port 9092          │
│                                  │ (Exposed)          │
└──────────────────────────────────┼─────────────────────┘
                                   │
                                   │ Network Connection
                                   │
┌──────────────────────────────────┼─────────────────────┐
│  FRIEND'S SYSTEM (Replica)        │                     │
│                                   │                     │
│  ┌──────────────┐                │                     │
│  │   Strapi     │────────────────┘                     │
│  │  (Replica)   │  Connects to YOUR Kafka             │
│  └──────────────┘  (No Kafka needed on replica!)      │
└─────────────────────────────────────────────────────────┘
```

**Key Points:**
- ✅ You run Kafka in Docker
- ✅ Your friend connects to YOUR Kafka (no Kafka needed on their side)
- ✅ Port 9092 must be accessible from network
- ⚠️ **Kafka MUST be running for sync to work** - it's the communication channel
- ✅ Full i18n/locale support - each language syncs independently
- ✅ Master edit tracking - conflicts are attributed correctly (admin vs ship)

---

## ⚠️ Critical: Kafka Availability

### What Happens When Kafka is Down?

**If you close Docker Kafka:**
- ❌ Replicas **cannot** sync to master (no communication channel)
- ✅ Replicas **continue working** locally (offline mode)
- ✅ All operations are **queued** in replica's `sync_queue` table
- ✅ **No data loss** - everything is saved locally

**When you restart Kafka:**
- ✅ Replicas **automatically detect** Kafka is back online
- ✅ Replicas **automatically reconnect** (no manual steps needed)
- ✅ All queued operations **automatically sync** to master
- ✅ Master receives all changes that happened while Kafka was down

### Best Practice

**Keep Kafka running continuously!**

```powershell
# Start Kafka and keep it running
docker-compose up -d kafka

# To auto-start Kafka on system boot, add to docker-compose.yml:
# restart: unless-stopped
```

**Why?**
- Kafka is the **communication channel** between master and replicas
- Without Kafka, replicas operate in offline mode (queued operations)
- When Kafka restarts, sync resumes automatically, but it's better to keep it running

### What Replicas Experience

**When Kafka is down:**
```
Replica Logs:
⚠️ Kafka producer connection deferred: Connection timeout
⚠️ Operating in offline mode - operations will be queued
✅ Content created successfully (saved locally)
📦 Operation queued for sync (will sync when Kafka is back)
```

**When Kafka restarts:**
```
Replica Logs:
✅ Kafka producer connected (replica mode)
🔄 Connectivity restored - starting sync
📤 Syncing 5 queued operations...
✅ All operations synced successfully
```

---

## 🔧 Quick Setup Steps

### Option A: Using ngrok (Recommended for Testing with Friend Far Away)

**Best for:** Testing when friend is in different location (not same WiFi)

**Steps:**

1. **Install ngrok:**
   - Download from: https://ngrok.com/download
   - Or use: `choco install ngrok` (if you have Chocolatey)

2. **Sign up for free ngrok account:**
   - Go to: https://dashboard.ngrok.com/signup
   - Get your authtoken from dashboard

3. **Configure ngrok:**
   ```powershell
   ngrok config add-authtoken <YOUR_AUTHTOKEN>
   ```

4. **Start Kafka in Docker:**
   ```powershell
   docker-compose up -d kafka
   ```

5. **Start ngrok tunnel:**
   ```powershell
   ngrok tcp 9092
   ```

6. **Copy the ngrok URL:**
   You'll see output like:
   ```
   Forwarding   tcp://0.tcp.ngrok.io:12345 -> localhost:9092
   ```
   
   Copy the URL: `0.tcp.ngrok.io:12345` (your port number will be different)

7. **Update docker-compose.yml:**
   ```yaml
   KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://0.tcp.ngrok.io:12345
   ```
   (Replace `0.tcp.ngrok.io:12345` with YOUR ngrok URL)

8. **Restart Kafka:**
   ```powershell
   docker-compose down
   docker-compose up -d kafka
   ```

9. **Keep ngrok running:**
   - Keep the ngrok terminal window open
   - If you close it, the tunnel stops and URL changes

10. **Share with friend:**
    ```
    KAFKA_BROKERS=0.tcp.ngrok.io:12345
    ```

**⚠️ Important Notes:**
- ngrok URL changes each time you restart it (unless paid plan)
- Keep ngrok terminal open while testing
- If URL changes, update `docker-compose.yml` and restart Kafka

---

### Option B: Same WiFi Network (Local Testing)

**Best for:** Testing when friend is on same WiFi network

1. **Find Your IP Address:**
   ```powershell
   ipconfig
   # Look for IPv4 Address (e.g., 192.168.1.100)
   # Use the IP address from your local network adapter (not 127.0.0.1)
   ```

2. **Update docker-compose.yml:**
   ```yaml
   KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://192.168.29.12:9092
   ```
   (Replace with YOUR local IP address)

3. **Open Windows Firewall:**
   ```powershell
   # Run PowerShell as Administrator
   New-NetFirewallRule -DisplayName "Kafka" -Direction Inbound -LocalPort 9092 -Protocol TCP -Action Allow
   ```

4. **Start/Restart Kafka in Docker:**
```powershell
# Stop Kafka if running
docker-compose down

# Start Kafka with new configuration
docker-compose up -d kafka

# Verify it's running
docker ps | findstr kafka
```

**Expected output:** You should see the `kafka` container running.

**⚠️ IMPORTANT:** Keep Kafka running! If you stop Kafka:
- Replicas cannot sync (they'll queue operations locally)
- When you restart Kafka, replicas will automatically reconnect and sync

**For auto-restart on system boot**, add to your `docker-compose.yml`:
```yaml
services:
  kafka:
    restart: unless-stopped
    # ... other config
```

### 5. Master .env Configuration (Same for Both Options)

```env
# Offline Sync - Master Mode
SYNC_MODE=master
SYNC_SHIP_ID=master

# Kafka (local)
KAFKA_BROKERS=localhost:9092

# Database
DATABASE_CLIENT=postgres
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=ship-master
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=root
```

### 6. Start Master
```powershell
npm run develop
```

---

## ✅ Verification

### Check Kafka is Accessible
```powershell
netstat -an | findstr 9092
# Should show: 0.0.0.0:9092
```

### Check Master Logs
Look for:
- `✅ Kafka producer connected (master mode)`
- `✅ Kafka consumer connected (master mode)`
- `📡 Subscribed to topic: ship-updates`

### When Replica Connects
You should see:
- `💓 Heartbeat from ship-001 - online`
- `[ShipTracker] ✅ New ship registered: ship-001`

### When Locale-Specific Content Syncs
You should see:
- `[Sync] 🌐 Adding new locale ar to existing api::article.article`
- `[Sync] ✅ Updated api::article.article [ar] (master: xyz123)`

---

## 📋 Information to Share with Friend

**IMPORTANT:** Your friend does NOT need to install or run Kafka. They will connect to YOUR Kafka running in Docker.

### If Using ngrok:

Share these details:
```
Hi! Here's what you need to connect:

- Kafka URL: 0.tcp.ngrok.io:12345
  (Use this EXACTLY in your .env: KAFKA_BROKERS=0.tcp.ngrok.io:12345)
- Your Ship ID: ship-001

You don't need to install Kafka - just connect to mine!
Use the REPLICA_SETUP_GUIDE.md I shared with you.
```

### If Using Same WiFi:

Share these details:
```
Hi! Here's what you need to connect:

- Master IP: 192.168.1.100
- Kafka Port: 9092
- Your Ship ID: ship-001

You don't need to install Kafka - just connect to mine!
Use the REPLICA_SETUP_GUIDE.md I shared with you.
```

---

## 🔍 Troubleshooting

### Ships Not Appearing

**Possible Causes:**

1. **Kafka is not running** (most common)
   - Check: `docker ps | findstr kafka`
   - Solution: Start Kafka: `docker-compose up -d kafka`
   - Note: Replicas will automatically reconnect when Kafka starts

2. **ngrok is not running** (if using ngrok)
   - Check: Is ngrok terminal window still open?
   - Solution: Start ngrok: `ngrok tcp 9092`
   - ⚠️ **Important:** ngrok URL changes when you restart it - update `docker-compose.yml` and restart Kafka

3. **Wrong address in docker-compose.yml**
   - **If using ngrok:** Check `KAFKA_ADVERTISED_LISTENERS` matches your current ngrok URL
   - **If using local IP:** Check `KAFKA_ADVERTISED_LISTENERS` uses your actual IP (not localhost)
   - Solution: Update docker-compose.yml with correct address

4. **Firewall blocking port 9092** (only for local IP, not ngrok)
   - Check: `netstat -an | findstr 9092`
   - Solution: Open firewall (see Option B, Step 3)

**Solutions:**
- ✅ Check if Kafka is running: `docker ps | findstr kafka`
- ✅ Check if ngrok is running (if using ngrok)
- ✅ Verify `KAFKA_ADVERTISED_LISTENERS` has correct address
- ✅ Check master logs for connection errors
- ✅ **Keep Kafka and ngrok running** - replicas need them to sync

### Kafka Connection Issues

**If you restart Kafka:**
- ✅ Replicas will automatically detect Kafka is back
- ✅ Replicas will automatically reconnect (no manual steps)
- ✅ All queued operations from replicas will sync automatically

**If you restart ngrok (if using ngrok):**
- ⚠️ **ngrok URL will change** - you must:
  1. Copy new ngrok URL from terminal
  2. Update `docker-compose.yml`: `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://<NEW_NGROK_URL>`
  3. Restart Kafka: `docker-compose down && docker-compose up -d kafka`
  4. Share new URL with friend (they need to update their `.env`)

**Commands:**
- Restart Kafka: `docker-compose restart kafka`
- Check logs: `docker logs kafka`
- Verify IP address hasn't changed: `ipconfig` (for local IP)
- Check ngrok status: Look at ngrok terminal window (for ngrok)

**Best Practice:** 
- Keep Kafka running continuously. Use `docker-compose up -d kafka` and add `restart: unless-stopped` to docker-compose.yml for auto-restart.
- **If using ngrok:** Keep ngrok terminal open. Consider using ngrok paid plan for static URLs.

---

## 📞 Quick Commands

```powershell
# Check Kafka status
docker ps | findstr kafka

# View Kafka logs
docker logs kafka

# Restart Kafka
docker-compose restart kafka

# Check if port is open
netstat -an | findstr 9092
```

---

**Share `REPLICA_SETUP_GUIDE.md` with your friend!**

---

## 🌍 Production Deployment

**For production where ships connect over the internet** (not same network):

👉 **See [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)** for:
- Cloud deployment options
- Public IP configuration
- VPN setup
- SSL/TLS security
- Production best practices

**Key Difference:**
- **This guide:** Same network (testing/local)
- **Production guide:** Internet connection (ships at sea)

---

## 🔧 Troubleshooting

### Populate Cache Error

If you see this error when creating/updating content:
```
duplicate key value violates unique constraint "caches_hash_idx"
```

**This is a Strapi internal race condition** when concurrent operations happen (Admin UI + Kafka sync).

**Solution:** Add this to your `.env` file:
```env
# Disable Strapi's populate cache to prevent race conditions with Kafka sync
STRAPI_DISABLE_POPULATE_CACHE=true
```

**Impact:** Minimal performance impact. The cache is just an optimization for populated relations.

