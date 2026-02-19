# 📚 Offline Sync Plugin Documentation

**Last Updated:** February 2026  
**Version:** 1.3

Welcome to the Offline Sync Plugin documentation! This directory contains all documentation related to the plugin.

---

## 📖 Documentation Index

### 🚀 Getting Started

- **[REPLICA_SETUP_GUIDE.md](./REPLICA_SETUP_GUIDE.md)** - Complete guide for setting up a Replica (Ship) system
- **[MASTER_SETUP_SUMMARY.md](./MASTER_SETUP_SUMMARY.md)** - Quick reference for Master setup (local network/testing)
- **[PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)** - Production deployment guide (ships over internet)

### 📦 Media Sync

- **[MINIO_MEDIA_SYNC.md](./MINIO_MEDIA_SYNC.md)** - Media synchronization between OSS and MinIO, including:
  - OSS-to-MinIO architecture and path mapping
  - First-time bulk sync via standalone script (`npm run sync:media`)
  - On-demand sync when content arrives via Kafka
  - File record syncing and relation handling
  - MinIO client configuration and URL transformation

### 🌊 Understanding Offline Sync

- **[OFFLINE_SYNC_EXPLAINED.md](./OFFLINE_SYNC_EXPLAINED.md)** - Detailed explanation of how offline sync works, including:
  - Offline-first architecture
  - Sync queue mechanism
  - Connectivity monitoring
  - Conflict detection & resolution (timestamp + source-based)
  - i18n/Locale-aware sync
  - New locale detection (no false conflicts)
  - Real-world examples

### 🏗️ Technical Design

- **[HIGH_LEVEL_DESIGN.md](./HIGH_LEVEL_DESIGN.md)** - High-level architecture and design decisions
- **[LOW_LEVEL_DESIGN.md](./LOW_LEVEL_DESIGN.md)** - Detailed technical implementation

---

## 🎯 Quick Navigation

### For Replica Administrators
1. Start with **[REPLICA_SETUP_GUIDE.md](./REPLICA_SETUP_GUIDE.md)**
2. Understand offline capabilities: **[OFFLINE_SYNC_EXPLAINED.md](./OFFLINE_SYNC_EXPLAINED.md)**
3. Set up media sync: **[MINIO_MEDIA_SYNC.md](./MINIO_MEDIA_SYNC.md)**

### For Master Administrators
1. **Testing/Local:** Quick setup: **[MASTER_SETUP_SUMMARY.md](./MASTER_SETUP_SUMMARY.md)** (same network)
2. **Production:** Deploy for ships: **[PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)** (over internet)
3. Share **[REPLICA_SETUP_GUIDE.md](./REPLICA_SETUP_GUIDE.md)** with replica administrators
4. Understand conflict resolution: **[OFFLINE_SYNC_EXPLAINED.md](./OFFLINE_SYNC_EXPLAINED.md)** (Conflict section)
5. Configure media sync: **[MINIO_MEDIA_SYNC.md](./MINIO_MEDIA_SYNC.md)**

### For Developers
1. Architecture overview: **[HIGH_LEVEL_DESIGN.md](./HIGH_LEVEL_DESIGN.md)**
2. Implementation details: **[LOW_LEVEL_DESIGN.md](./LOW_LEVEL_DESIGN.md)**
3. How it works: **[OFFLINE_SYNC_EXPLAINED.md](./OFFLINE_SYNC_EXPLAINED.md)**
4. Media sync: **[MINIO_MEDIA_SYNC.md](./MINIO_MEDIA_SYNC.md)**

---

## 📋 Document Descriptions

### REPLICA_SETUP_GUIDE.md
**Purpose:** Step-by-step guide for setting up a replica system  
**Audience:** Replica administrators, ship operators  
**Contents:**
- Prerequisites
- Installation steps
- Configuration
- Network setup
- Troubleshooting
- Monitoring

### MASTER_SETUP_SUMMARY.md
**Purpose:** Quick reference for master setup  
**Audience:** Master administrators  
**Contents:**
- Quick setup steps (ngrok recommended for testing with friends far away)
- Kafka configuration (ngrok or local IP)
- Firewall setup (for local IP)
- Information to share with replicas

### OFFLINE_SYNC_EXPLAINED.md
**Purpose:** Comprehensive explanation of offline sync functionality  
**Audience:** All users (administrators, developers)  
**Contents:**
- How offline sync works
- Sync queue mechanism
- Connectivity monitoring
- Conflict detection & resolution
- Real-world examples
- Best practices

### HIGH_LEVEL_DESIGN.md
**Purpose:** Architecture and design decisions  
**Audience:** Developers, architects  
**Contents:**
- System architecture
- Design patterns
- Component interactions
- Data flow

### LOW_LEVEL_DESIGN.md
**Purpose:** Detailed technical implementation  
**Audience:** Developers  
**Contents:**
- Service implementations
- Database schemas
- API specifications
- Code structure

### MINIO_MEDIA_SYNC.md
**Purpose:** Media synchronization between Alibaba Cloud OSS and MinIO  
**Audience:** Administrators, DevOps, Developers  
**Contents:**
- OSS-to-MinIO sync architecture
- First-time bulk sync via standalone script (`npm run sync:media`)
- On-demand sync for content arriving via Kafka
- `ossPathToMinioPath` path mapping (strips `uploads/` prefix)
- File record syncing (`plugin::upload.file` via `fileRecords` field)
- MinIO client configuration
- URL transformation for replica environments

### PRODUCTION_DEPLOYMENT.md
**Purpose:** Production deployment guide for ships connecting over internet  
**Audience:** System Administrators, DevOps, Production Teams  
**Contents:**
- Production architecture (ships over internet)
- Deployment options (Public IP, Cloud, VPN, Reverse Proxy)
- Security configuration (SSL/TLS, SASL authentication)
- Network requirements
- Configuration examples
- Testing production setup
- Common production issues
- Monitoring and best practices

---

## 🔗 Related Documentation

- **[Plugin README](../README.md)** - Main plugin documentation
- **[Database README](../database/README.md)** - Database setup and migrations

---

## 📞 Need Help?

- Check the troubleshooting sections in the setup guides
- Review the conflict resolution section in OFFLINE_SYNC_EXPLAINED.md
- Consult the technical design documents for implementation details

---

**Last Updated:** February 2026

---

## 🆕 What's New in v1.3

- **Media Sync Architecture Overhaul** - Bulk sync via standalone script (`npm run sync:media`); on-demand sync still built-in for Kafka-delivered content
- **File Record Syncing** - Master includes `plugin::upload.file` records in Kafka messages (`fileRecords` field); replicas create local file entries for proper relation handling
- **OSS-to-MinIO Path Mapping** - `ossPathToMinioPath` helper strips the `uploads/` prefix for correct MinIO storage
- **Sensitive Data Handling** - `stripSensitiveData` now omits sensitive keys entirely instead of replacing with `[REDACTED]`
- **Legacy Code Cleanup** - Removed dead code in `server/controllers/`, `server/services/`, and `server/bootstrap.ts` (superseded by `server/src/`)
- **Production Logging** - All `console.error` replaced with `strapi.log.error` across service files
- **Development Mode** - `watchIgnoreFiles` in admin config prevents server restarts from MinIO writes to `docker/uploads`

