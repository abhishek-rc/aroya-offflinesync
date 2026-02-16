# 📐 Offline Sync Plugin - Low Level Design (LLD)

## Document Information

| Field | Value |
|-------|-------|
| **Version** | 1.2 |
| **Last Updated** | January 2026 |
| **Platform** | Strapi 5.x |
| **Message Broker** | Apache Kafka |
| **Database** | PostgreSQL |

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Component Design](#3-component-design)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
5. [Database Design](#5-database-design)
6. [API Design](#6-api-design)
7. [Sequence Diagrams](#7-sequence-diagrams)
8. [Error Handling](#8-error-handling)
9. [Security Design](#9-security-design)
10. [Performance Considerations](#10-performance-considerations)

---

## 1. System Overview

### 1.1 Purpose

The Offline Sync Plugin enables bi-directional data synchronization between a central **Master** instance and multiple **Replica** (ship) instances that may operate with intermittent connectivity.

### 1.2 Design Goals

| Goal | Description |
|------|-------------|
| **Offline-First** | Replicas operate fully offline, sync when connected |
| **Eventual Consistency** | All instances converge to same state eventually |
| **Conflict Detection** | Identify concurrent modifications automatically |
| **Idempotency** | Same message processed exactly once |
| **Fault Tolerance** | Handle network failures gracefully |
| **i18n Support** | Each locale syncs independently without false conflicts |
| **Edit Source Tracking** | Distinguish master admin edits from ship edits |

### 1.3 System Actors

```
┌─────────────────────────────────────────────────────────────────┐
│                        ACTORS                                    │
├─────────────────────────────────────────────────────────────────┤
│  👤 Admin User          - Manages content on Master/Replica     │
│  🖥️ Master Instance     - Central server (onshore)              │
│  🚢 Replica Instance    - Remote server (ship/offshore)         │
│  📨 Kafka Broker        - Message queue infrastructure          │
│  🗄️ PostgreSQL          - Database for each instance            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Diagram

### 2.1 High-Level Architecture

```
                              ┌─────────────────┐
                              │   KAFKA CLUSTER │
                              │                 │
                              │ ┌─────────────┐ │
                              │ │ship-updates │ │
                              │ │   (topic)   │ │
                              │ └─────────────┘ │
                              │ ┌─────────────┐ │
                              │ │master-updates│ │
                              │ │   (topic)   │ │
                              │ └─────────────┘ │
                              └────────┬────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        │                        ▼
┌─────────────────────────┐            │          ┌─────────────────────────┐
│      MASTER SERVER      │            │          │    REPLICA SERVER       │
│      (mode: master)     │            │          │    (mode: replica)      │
├─────────────────────────┤            │          ├─────────────────────────┤
│                         │            │          │                         │
│  ┌───────────────────┐  │            │          │  ┌───────────────────┐  │
│  │  Kafka Consumer   │◄─┼────────────┘          │  │  Kafka Producer   │──┼──┐
│  │  (ship-updates)   │  │                       │  │  (ship-updates)   │  │  │
│  └───────────────────┘  │                       │  └───────────────────┘  │  │
│                         │                       │                         │  │
│  ┌───────────────────┐  │       ┌───────────────┼──┌───────────────────┐  │  │
│  │  Kafka Producer   │──┼───────┘               │  │  Kafka Consumer   │◄─┼──┘
│  │ (master-updates)  │  │                       │  │ (master-updates)  │  │
│  └───────────────────┘  │                       │  └───────────────────┘  │
│                         │                       │                         │
│  ┌───────────────────┐  │                       │  ┌───────────────────┐  │
│  │   Sync Service    │  │                       │  │   Sync Service    │  │
│  │ processShipUpdate │  │                       │  │ processMasterUpd  │  │
│  └───────────────────┘  │                       │  └───────────────────┘  │
│                         │                       │                         │
│  ┌───────────────────┐  │                       │  ┌───────────────────┐  │
│  │ Conflict Resolver │  │                       │  │    Sync Queue     │  │
│  └───────────────────┘  │                       │  └───────────────────┘  │
│                         │                       │                         │
│  ┌───────────────────┐  │                       │  ┌───────────────────┐  │
│  │ Document Mapping  │  │                       │  │ Document Mapping  │  │
│  └───────────────────┘  │                       │  └───────────────────┘  │
│                         │                       │                         │
└───────────┬─────────────┘                       └───────────┬─────────────┘
            │                                                 │
            ▼                                                 ▼
   ┌─────────────────┐                               ┌─────────────────┐
   │   PostgreSQL    │                               │   PostgreSQL    │
   │   (Master DB)   │                               │   (Replica DB)  │
   └─────────────────┘                               └─────────────────┘
```

### 2.2 Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OFFLINE-SYNC PLUGIN                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          BOOTSTRAP LAYER                             │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │    │
│  │  │ Config Validator│  │Document Middleware│ │Graceful Shutdown│      │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          SERVICE LAYER                               │    │
│  │                                                                       │    │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐          │    │
│  │  │  Sync Service  │  │ Kafka Producer │  │ Kafka Consumer │          │    │
│  │  │                │  │                │  │                │          │    │
│  │  │ - push()       │  │ - connect()    │  │ - connect()    │          │    │
│  │  │ - pull()       │  │ - send()       │  │ - processMsg() │          │    │
│  │  │ - processShip  │  │ - sendToShips()│  │ - disconnect() │          │    │
│  │  │ - processMaster│  │ - sendHeartbeat│  │                │          │    │
│  │  └────────────────┘  └────────────────┘  └────────────────┘          │    │
│  │                                                                       │    │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐          │    │
│  │  │Conflict Resolver│ │Document Mapping│  │ Message Tracker│          │    │
│  │  │                │  │                │  │                │          │    │
│  │  │ - logConflict()│  │ - getMapping() │  │ - isProcessed()│          │    │
│  │  │ - listConflicts│  │ - setMapping() │  │ - markProcessed│          │    │
│  │  │ - resolveConfl │  │ - deleteMap()  │  │ - cleanup()    │          │    │
│  │  └────────────────┘  └────────────────┘  └────────────────┘          │    │
│  │                                                                       │    │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐          │    │
│  │  │  Sync Queue    │  │  Ship Tracker  │  │  Dead Letter   │          │    │
│  │  │                │  │                │  │                │          │    │
│  │  │ - enqueue()    │  │ - registerShip │  │ - add()        │          │    │
│  │  │ - dequeue()    │  │ - listShips()  │  │ - getPending() │          │    │
│  │  │ - markPushed() │  │ - markOffline()│  │ - markResolved │          │    │
│  │  └────────────────┘  └────────────────┘  └────────────────┘          │    │
│  │                                                                       │    │
│  │  ┌────────────────┐  ┌────────────────┐                              │    │
│  │  │Connectivity Mon│  │Version Manager │                              │    │
│  │  │                │  │                │                              │    │
│  │  │ - startMonitor │  │ - getVersion() │                              │    │
│  │  │ - checkConnect │  │ - increment()  │                              │    │
│  │  └────────────────┘  └────────────────┘                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         CONTROLLER LAYER                             │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │    │
│  │  │ Sync Controller │  │Conflict Controller│ │Health Controller│      │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       CONTENT TYPE LAYER                             │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │    │
│  │  │  Document   │ │  Processed  │ │ Dead Letter │ │    Ship     │    │    │
│  │  │   Mapping   │ │   Message   │ │             │ │  Registry   │    │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Design

### 3.1 Service Components

#### 3.1.1 Sync Service (`sync-service.ts`)

**Responsibility:** Core synchronization logic for processing updates.

```typescript
interface SyncService {
  // Replica: Push local changes to master
  push(): Promise<{ pushed: number; failed: number }>;
  
  // Replica: Pull updates from master (via Kafka subscription)
  pull(): Promise<{ pulled: number; conflicts: number }>;
  
  // Master: Process incoming ship update
  processShipUpdate(message: SyncMessage): Promise<void>;
  
  // Replica: Process incoming master update
  processMasterUpdate(message: SyncMessage): Promise<void>;
  
  // Utility: Clean internal fields from data
  cleanSyncData(data: object): object;
}
```

#### 3.1.2 Kafka Producer (`kafka-producer.ts`)

**Responsibility:** Send messages to Kafka topics.

```typescript
interface KafkaProducer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // Send sync message
  send(message: SyncMessage, topic?: string): Promise<any>;
  
  // Send batch of messages
  sendBatch(messages: SyncMessage[]): Promise<any>;
  
  // Master: Send to ships
  sendToShips(message: SyncMessage): Promise<boolean>;
  
  // Replica: Send heartbeat
  sendHeartbeat(): Promise<boolean>;
  
  // Health check
  healthCheck(): Promise<boolean>;
  isConnected(): boolean;
}
```

#### 3.1.3 Kafka Consumer (`kafka-consumer.ts`)

**Responsibility:** Consume messages from Kafka topics.

```typescript
interface KafkaConsumer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // Process incoming message (routes to appropriate handler)
  processMessage(message: any): Promise<void>;
  
  isConnected(): boolean;
}
```

#### 3.1.4 Conflict Resolver (`conflict-resolver.ts`)

**Responsibility:** Detect, log, and resolve conflicts.

```typescript
interface ConflictResolver {
  // Log a conflict (updates existing if unresolved)
  logConflict(conflict: ConflictData): Promise<any>;
  
  // List unresolved conflicts
  listConflicts(): Promise<Conflict[]>;
  
  // Get specific conflict
  getConflict(id: number): Promise<Conflict | null>;
  
  // Resolve conflict with strategy
  resolveConflict(
    id: number,
    strategy: 'keep-ship' | 'keep-master' | 'merge',
    mergeData?: object
  ): Promise<any>;
}
```

#### 3.1.5 Document Mapping (`document-mapping.ts`)

**Responsibility:** Map replica document IDs to master document IDs.

```typescript
interface DocumentMapping {
  // Get full mapping (includes timestamps)
  getMapping(shipId: string, contentType: string, replicaDocId: string): Promise<Mapping | null>;
  
  // Get master document ID only
  getMasterDocumentId(shipId: string, contentType: string, replicaDocId: string): Promise<string | null>;
  
  // Create or update mapping
  setMapping(shipId: string, contentType: string, replicaDocId: string, masterDocId: string): Promise<Mapping>;
  
  // Delete mapping
  deleteMapping(shipId: string, contentType: string, replicaDocId: string): Promise<boolean>;
  
  // Reverse lookup: find by master ID
  findByMasterDocumentId(shipId: string, contentType: string, masterDocId: string): Promise<Mapping | null>;
}
```

#### 3.1.6 Sync Queue (`sync-queue.ts`)

**Responsibility:** Queue operations when replica is offline for later sync.

```typescript
interface SyncQueue {
  // Enqueue an operation for sync
  enqueue(operation: {
    shipId: string;
    contentType: string;
    contentId: string | number;
    operation: 'create' | 'update' | 'delete';
    localVersion: number;
    data: any;
  }): Promise<any>;
  
  // Dequeue pending operations
  dequeue(shipId: string, limit: number): Promise<any[]>;
  
  // Mark operation as synced
  markSynced(queueId: number): Promise<void>;
  
  // Mark operation as failed
  markFailed(queueId: number, error: Error): Promise<void>;
  
  // Mark operation as conflict
  markConflict(options: {
    queueId: number;
    conflictId: number;
    reason: string;
  }): Promise<void>;
  
  // Get pending count
  getPending(shipId: string): Promise<number>;
  
  // Get conflict entries
  getConflicts(shipId: string): Promise<any[]>;
}
```

#### 3.1.7 Connectivity Monitor (`connectivity-monitor.ts`)

**Responsibility:** Monitor network connectivity for replica instances.

```typescript
interface ConnectivityMonitor {
  // Start connectivity monitoring
  startMonitoring(interval: number): Promise<void>;
  
  // Stop connectivity monitoring
  stopMonitoring(): void;
  
  // Check connectivity to master
  checkConnectivity(): Promise<{ isOnline: boolean; error?: string }>;
  
  // Get current connectivity status
  isConnected(): boolean;
}
```

#### 3.1.8 Version Manager (`version-manager.ts`)

**Responsibility:** Track document versions for conflict detection.

```typescript
interface VersionManager {
  // Increment version for a document
  incrementVersion(
    contentType: string,
    documentId: string | number,
    shipId: string
  ): Promise<number>;
  
  // Get current version
  getVersion(
    contentType: string,
    documentId: string | number,
    shipId: string
  ): Promise<number>;
}
```

#### 3.1.9 Ship Tracker (`ship-tracker.ts`)

**Responsibility:** Track ship connectivity status (master mode only).

```typescript
interface ShipTracker {
  // Register or update ship
  registerShip(shipId: string, shipName?: string): Promise<Ship | null>;
  
  // Get ship status
  getShip(shipId: string): Promise<Ship | null>;
  
  // List all ships
  listShips(): Promise<Ship[]>;
  
  // Update ship connectivity status
  updateConnectivityStatus(shipId: string, status: 'online' | 'offline'): Promise<void>;
}
```

#### 3.1.10 Message Tracker (`message-tracker.ts`)

**Responsibility:** Ensure idempotent message processing.

```typescript
interface MessageTracker {
  // Check if message was already processed
  isProcessed(messageId: string): Promise<boolean>;
  
  // Mark message as processed
  markProcessed(messageId: string, metadata: any): Promise<void>;
  
  // Clean old processed messages
  cleanup(olderThan: Date): Promise<number>;
}
```

#### 3.1.11 Dead Letter (`dead-letter.ts`)

**Responsibility:** Handle failed messages that cannot be processed.

```typescript
interface DeadLetter {
  // Add message to dead letter queue
  add(message: any, error: Error): Promise<void>;
  
  // List dead letter entries
  list(limit?: number): Promise<DeadLetter[]>;
  
  // Retry dead letter entry
  retry(id: number): Promise<boolean>;
  
  // Remove dead letter entry
  remove(id: number): Promise<boolean>;
}
```

#### 3.1.12 Master Sync Queue (`master-sync-queue.ts`) - Master Only

**Responsibility:** Queue master changes when Kafka is offline and track edit sources.

```typescript
interface MasterSyncQueue {
  // Enqueue master operation for later sync (when Kafka offline)
  enqueue(operation: {
    contentType: string;
    documentId: string;
    operation: 'create' | 'update' | 'delete';
    data: any;
    locale?: string;
  }): Promise<any>;
  
  // Dequeue pending operations
  dequeue(limit: number): Promise<any[]>;
  
  // Mark as synced
  markSynced(queueId: number): Promise<void>;
  
  // Log edit for conflict detection
  logEdit(edit: {
    contentType: string;
    documentId: string;
    operation: string;
    editedBy: string;  // 'master-admin' | 'ship-{shipId}'
    locale?: string;
  }): Promise<void>;
  
  // Get last editor for conflict attribution
  getLastEditor(contentType: string, documentId: string): Promise<{
    editedBy: string;
    editedAt: Date;
  } | null>;
}
```

### 3.2 Data Structures

#### 3.2.1 Sync Message

```typescript
interface SyncMessage {
  messageId: string;        // Unique message identifier
  shipId: string;           // Ship identifier
  timestamp: string;        // ISO timestamp
  operation: 'create' | 'update' | 'delete' | 'heartbeat';
  contentType: string;      // e.g., "api::article.article"
  contentId: string;        // Document ID
  version: number;          // Version number
  data: object | null;      // Document data (null for delete)
  locale?: string;          // i18n locale (e.g., "en", "ar")
  masterDocumentId?: string; // Master doc ID (for updates/deletes)
  metadata?: {
    queueId?: number;       // Sync queue ID
  };
}
```

#### 3.2.2 Conflict Data

```typescript
interface ConflictData {
  contentType: string;
  contentId: string;
  shipId: string;
  shipVersion: number;
  masterVersion: number;
  shipData: object;
  masterData: object;
  conflictType: 'concurrent-edit' | 'master-admin-edit';  // Edit source type
  locale?: string;          // i18n locale if applicable
}
```

#### 3.2.3 Document Mapping

```typescript
interface DocumentMapping {
  id: number;
  documentId: string;
  shipId: string;
  contentType: string;
  replicaDocumentId: string;
  masterDocumentId: string;
  lastSyncedBy: string;    // 'master' | 'ship-{shipId}' - who made last sync
  createdAt: Date;
  updatedAt: Date;         // Used for conflict detection
}
```

---

## 4. Data Flow Diagrams

### 4.1 Replica → Master (Push Flow)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         REPLICA → MASTER PUSH FLOW                            │
└──────────────────────────────────────────────────────────────────────────────┘

  REPLICA                                                    MASTER
  ───────                                                    ──────

  ┌─────────────┐
  │ User Action │
  │ (Create/    │
  │  Update/    │
  │  Delete)    │
  └──────┬──────┘
         │
         ▼
  ┌─────────────────────┐
  │ Document Middleware │
  │ (bootstrap.ts)      │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ Version Manager     │
  │ incrementVersion()  │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ Sync Queue          │
  │ enqueue()           │
  │ ┌─────────────────┐ │
  │ │ status: pending │ │
  │ └─────────────────┘ │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ Debounced Push      │
  │ (1 second delay)    │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ Connectivity Check  │
  │ isOnline?           │
  └──────────┬──────────┘
             │
     ┌───────┴───────┐
     │               │
   OFFLINE         ONLINE
     │               │
     ▼               ▼
  ┌────────┐    ┌─────────────────────┐
  │ Wait   │    │ Kafka Producer      │
  │ (retry │    │ send()              │
  │  later)│    └──────────┬──────────┘
  └────────┘               │
                           │
                           ▼
                    ╔══════════════════╗
                    ║  KAFKA BROKER    ║
                    ║  ship-updates    ║
                    ╚════════╤═════════╝
                             │
                             │                      ┌─────────────────────┐
                             └─────────────────────►│ Kafka Consumer      │
                                                    │ processMessage()    │
                                                    └──────────┬──────────┘
                                                               │
                                                               ▼
                                                    ┌─────────────────────┐
                                                    │ Message Tracker     │
                                                    │ isProcessed?        │
                                                    └──────────┬──────────┘
                                                               │
                                                       ┌───────┴───────┐
                                                       │               │
                                                    DUPLICATE       NEW
                                                       │               │
                                                       ▼               ▼
                                                    ┌────────┐  ┌─────────────────────┐
                                                    │ Skip   │  │ Document Mapping    │
                                                    └────────┘  │ getMasterDocumentId │
                                                                └──────────┬──────────┘
                                                                           │
                                                                   ┌───────┴───────┐
                                                                   │               │
                                                                NEW DOC         EXISTS
                                                                   │               │
                                                                   ▼               ▼
                                                            ┌──────────┐  ┌─────────────────┐
                                                            │ CREATE   │  │ Conflict Check  │
                                                            │ Document │  │ master.updatedAt│
                                                            │ + Map    │  │ > mapping.updAt?│
                                                            └──────────┘  └────────┬────────┘
                                                                                   │
                                                                           ┌───────┴───────┐
                                                                           │               │
                                                                        CONFLICT       NO CONFLICT
                                                                           │               │
                                                                           ▼               ▼
                                                                    ┌──────────┐    ┌──────────┐
                                                                    │Log Conflict│   │ UPDATE   │
                                                                    │(admin      │   │ Document │
                                                                    │ resolves)  │   │ + status │
                                                                    └──────────┘    │ published│
                                                                                    └──────────┘
```

### 4.2 Master → Replica (Pull Flow)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         MASTER → REPLICA PULL FLOW                            │
└──────────────────────────────────────────────────────────────────────────────┘

  MASTER                                                     REPLICA
  ──────                                                     ───────

  ┌─────────────┐
  │ User Action │
  │ (Create/    │
  │  Update/    │
  │  Delete)    │
  └──────┬──────┘
         │
         ▼
  ┌─────────────────────┐
  │ Document Middleware │
  │ (bootstrap.ts)      │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ Kafka Producer      │
  │ sendToShips()       │
  └──────────┬──────────┘
             │
             ▼
      ╔══════════════════╗
      ║  KAFKA BROKER    ║
      ║ master-updates   ║
      ╚════════╤═════════╝
               │
               │                                      ┌─────────────────────┐
               └─────────────────────────────────────►│ Kafka Consumer      │
                                                      │ processMessage()    │
                                                      └──────────┬──────────┘
                                                                 │
                                                                 ▼
                                                      ┌─────────────────────┐
                                                      │ Document Mapping    │
                                                      │ findByMasterDocId() │
                                                      └──────────┬──────────┘
                                                                 │
                                                         ┌───────┴───────┐
                                                         │               │
                                                      NO LOCAL       HAS LOCAL
                                                         │               │
                                                         ▼               ▼
                                                  ┌──────────┐   ┌─────────────────┐
                                                  │ CREATE   │   │ Local Conflict? │
                                                  │ Local    │   │ local.updatedAt │
                                                  │ Document │   │ > map.updatedAt?│
                                                  └──────────┘   └────────┬────────┘
                                                                          │
                                                                  ┌───────┴───────┐
                                                                  │               │
                                                               CONFLICT       NO CONFLICT
                                                                  │               │
                                                                  ▼               ▼
                                                           ┌──────────┐    ┌──────────┐
                                                           │Log Warning│    │ UPDATE   │
                                                           │(master    │    │ Local    │
                                                           │ wins)     │    │ Document │
                                                           └──────────┘    └──────────┘
```

### 4.3 Conflict Resolution Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         CONFLICT RESOLUTION FLOW                              │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────┐
  │ Admin accesses      │
  │ /conflicts endpoint │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ List unresolved     │
  │ conflicts           │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ Admin reviews       │
  │ ship_data vs        │
  │ master_data         │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ Choose strategy     │
  └──────────┬──────────┘
             │
     ┌───────┼───────┬───────────────┐
     │       │       │               │
     ▼       ▼       ▼               ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│keep-ship│ │keep-mast│ │  merge  │
└────┬────┘ └────┬────┘ └────┬────┘
     │           │           │
     ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────────────┐
│Update   │ │Publish  │ │Update with      │
│master   │ │existing │ │merged data      │
│with     │ │master   │ │                 │
│ship_data│ │data     │ │                 │
└────┬────┘ └────┬────┘ └────────┬────────┘
     │           │               │
     └───────────┼───────────────┘
                 │
                 ▼
     ┌─────────────────────┐
     │ Update document     │
     │ mapping timestamp   │
     │ (prevents future    │
     │  false conflicts)   │
     └──────────┬──────────┘
                │
                ▼
     ┌─────────────────────┐
     │ Mark conflict as    │
     │ resolved            │
     └─────────────────────┘
```

---

## 5. Database Design

### 5.1 Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ENTITY RELATIONSHIP DIAGRAM                           │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌───────────────────┐           ┌───────────────────┐
    │   ship_registry   │           │  document_mapping │
    ├───────────────────┤           ├───────────────────┤
    │ PK documentId     │           │ PK documentId     │
    │    shipId         │◄─────────┐│    shipId         │
    │    shipName       │          ││    contentType    │
    │    connectivity   │          ││    replicaDocId   │
    │    lastSeenAt     │          ││    masterDocId    │
    │    metadata       │          ││    createdAt      │
    │    createdAt      │          ││    updatedAt      │──────┐
    │    updatedAt      │          │└───────────────────┘      │
    └───────────────────┘          │                           │
                                   │                           │
                                   │                           │ (timestamp used
    ┌───────────────────┐          │                           │  for conflict
    │    sync_queue     │          │                           │  detection)
    ├───────────────────┤          │                           │
    │ PK id             │          │                           │
    │    shipId         │──────────┘                           │
    │    contentType    │                                      │
    │    contentId      │                                      │
    │    operation      │              ┌───────────────────┐   │
    │    localVersion   │              │   conflict_logs   │   │
    │    data (JSONB)   │              ├───────────────────┤   │
    │    status         │              │ PK id             │   │
    │    errorMessage   │              │    contentType    │   │
    │    retryCount     │              │    contentId      │───┘
    │    kafkaOffset    │              │    shipId         │
    │    syncedAt       │              │    shipVersion    │
    │    createdAt      │              │    masterVersion  │
    │    updatedAt      │              │    shipData       │
    └───────────────────┘              │    masterData     │
                                       │    conflictType   │
                                       │    resolution     │
    ┌───────────────────┐              │    resolvedAt     │
    │ processed_message │              │    resolvedBy     │
    ├───────────────────┤              │    createdAt      │
    │ PK documentId     │              │    updatedAt      │
    │    messageId      │◄─────────────└───────────────────┘
    │    shipId         │
    │    contentType    │
    │    contentId      │
    │    operation      │              ┌───────────────────┐
    │    status         │              │    dead_letter    │
    │    processedAt    │              ├───────────────────┤
    │    createdAt      │              │ PK documentId     │
    │    updatedAt      │              │    messageId      │
    └───────────────────┘              │    shipId         │
                                       │    contentType    │
                                       │    contentId      │
                                       │    operation      │
                                       │    payload        │
                                       │    errorMessage   │
                                       │    retryCount     │
                                       │    maxRetries     │
                                       │    status         │
                                       │    resolvedAt     │
                                       │    createdAt      │
                                       └───────────────────┘
```

### 5.2 Table Specifications

#### 5.2.1 sync_queue (Raw SQL Table) - Replica Only

**Purpose:** Queue operations when replica is offline for later sync to master.

**Status Flow:**
- `pending` → Operation waiting to be synced
- `syncing` → Currently being sent to Kafka
- `synced` → Successfully synced to master
- `failed` → Failed to sync (will retry)
- `conflict` → Master rejected due to conflict

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| ship_id | VARCHAR(255) | NOT NULL | Ship identifier |
| content_type | VARCHAR(255) | NOT NULL | Strapi content type |
| content_id | VARCHAR(255) | NOT NULL | Document ID |
| operation | VARCHAR(50) | NOT NULL, CHECK | create/update/delete |
| local_version | INTEGER | DEFAULT 0 | Version number |
| data | JSONB | | Document data |
| status | VARCHAR(50) | DEFAULT 'pending' | Queue status |
| error_message | TEXT | | Error if failed |
| retry_count | INTEGER | DEFAULT 0 | Retry attempts |
| kafka_offset | BIGINT | | Kafka offset |
| synced_at | TIMESTAMP | | Sync completion time |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |
| updated_at | TIMESTAMP | | Last update time |

**Indexes:**
- `idx_sync_queue_ship_status(ship_id, status)`
- `idx_sync_queue_created_at(created_at)`

#### 5.2.2 conflict_logs (Raw SQL Table)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment ID |
| content_type | VARCHAR(255) | NOT NULL | Strapi content type |
| content_id | VARCHAR(255) | NOT NULL | Master document ID |
| ship_id | VARCHAR(255) | NOT NULL | Conflicting ship |
| ship_version | INTEGER | | Ship's version |
| master_version | INTEGER | | Master's version |
| ship_data | JSONB | | Ship's data |
| master_data | JSONB | | Master's data |
| conflict_type | VARCHAR(100) | | Type of conflict |
| resolution_strategy | VARCHAR(50) | | Resolution chosen |
| resolution_data | JSONB | | Merged data |
| resolved_at | TIMESTAMP | | Resolution time |
| resolved_by | VARCHAR(255) | | Who resolved |
| created_at | TIMESTAMP | DEFAULT NOW() | Detection time |
| updated_at | TIMESTAMP | | Last update time |

**Indexes:**
- `idx_conflict_logs_unresolved(content_type, content_id, ship_id) WHERE resolved_at IS NULL`
- `idx_conflict_logs_ship(ship_id)`

---

## 6. API Design

### 6.1 REST Endpoints

#### 6.1.1 Sync Endpoints

| Method | Path | Description | Mode |
|--------|------|-------------|------|
| GET | `/api/offline-sync/status` | Get sync status | Both |
| POST | `/api/offline-sync/push` | Trigger manual push | Replica |
| POST | `/api/offline-sync/pull` | Trigger manual pull | Replica |
| GET | `/api/offline-sync/queue` | Get sync queue | Replica |
| GET | `/api/offline-sync/queue/pending` | Get pending count | Replica |
| GET | `/api/offline-sync/ships` | List ships | Master |

#### 6.1.2 Conflict Endpoints

| Method | Path | Description | Mode |
|--------|------|-------------|------|
| GET | `/api/offline-sync/conflicts` | List conflicts | Master |
| GET | `/api/offline-sync/conflicts/:id` | Get conflict | Master |
| POST | `/api/offline-sync/conflicts/:id/resolve` | Resolve conflict | Master |

#### 6.1.3 Health Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/offline-sync/health/live` | Liveness probe |
| GET | `/api/offline-sync/health/ready` | Readiness probe |
| GET | `/api/offline-sync/health` | Detailed health |
| GET | `/api/offline-sync/health/metrics` | Prometheus metrics |

### 6.2 Request/Response Formats

#### Resolve Conflict Request
```json
POST /api/offline-sync/conflicts/:id/resolve
{
  "strategy": "keep-ship" | "keep-master" | "merge",
  "mergeData": { ... }  // Required only for "merge"
}
```

#### Health Response
```json
GET /api/offline-sync/health
{
  "status": "healthy" | "degraded" | "unhealthy",
  "mode": "master" | "replica",
  "shipId": "ship-001" | null,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600.5,
  "checks": {
    "database": { "status": "healthy", "latency": 5 },
    "kafka": { "status": "healthy", "role": "consumer" },
    "messageTracker": { "total": 100, "processed": 98, "failed": 2 },
    "deadLetterQueue": { "pending": 1, "exhausted": 0 }
  }
}
```

---

## 7. Sequence Diagrams

### 7.1 Create Document on Replica

```
┌──────┐     ┌────────────┐     ┌──────────┐     ┌───────┐     ┌────────┐     ┌────────┐
│ User │     │ Middleware │     │SyncQueue │     │Producer│     │ Kafka  │     │ Master │
└──┬───┘     └─────┬──────┘     └────┬─────┘     └───┬───┘     └───┬────┘     └───┬────┘
   │               │                  │               │             │             │
   │ create doc    │                  │               │             │             │
   │──────────────►│                  │               │             │             │
   │               │                  │               │             │             │
   │               │ enqueue()        │               │             │             │
   │               │─────────────────►│               │             │             │
   │               │                  │               │             │             │
   │               │ trigger push     │               │             │             │
   │               │──────────────────┼──────────────►│             │             │
   │               │                  │               │             │             │
   │               │                  │   dequeue()   │             │             │
   │               │                  │◄──────────────│             │             │
   │               │                  │               │             │             │
   │               │                  │               │ send()      │             │
   │               │                  │               │────────────►│             │
   │               │                  │               │             │             │
   │               │                  │               │             │ consume     │
   │               │                  │               │             │────────────►│
   │               │                  │               │             │             │
   │               │                  │               │             │  process    │
   │               │                  │               │             │────────────►│
   │               │                  │               │             │             │
   │               │                  │               │             │◄────────────│
   │               │                  │               │             │   ack       │
   │               │                  │               │             │             │
   │◄──────────────│                  │               │             │             │
   │   response    │                  │               │             │             │
   │               │                  │               │             │             │
```

### 7.2 Conflict Detection and Resolution (Timestamp + Source-Based)

**Conflict Detection Algorithm:**

The system uses **timestamp-based conflict detection with edit source tracking** to accurately identify conflicts:

```typescript
// When ship sends update to master:
const mapping = await documentMapping.getMapping(shipId, contentType, replicaDocumentId);
const lastSyncedAt = mapping?.updatedAt;      // When ship last synced
const lastSyncedBy = mapping?.lastSyncedBy;   // Who made the last sync ('master' | 'ship-X')

// IMPORTANT: Get master doc WITH locale for i18n-aware detection
const findOptions: any = { documentId: masterDocumentId };
if (message.locale) {
  findOptions.locale = message.locale;
}
const masterDoc = await strapi.documents(contentType).findOne(findOptions);
const masterUpdatedAt = masterDoc?.updatedAt;

// NEW: Check for new locale (no conflict possible)
const isNewLocale = message.locale && !masterDoc;
if (isNewLocale) {
  // Directly apply - this is adding a new locale, not modifying existing
  return;
}

// Check master_edit_log for admin edits
const masterDirectEdit = await masterSyncQueue.getLastEditor(contentType, masterDocumentId);

// Conflict Detection:
// Case 1: Master modified after last sync by DIFFERENT ship
const masterModifiedAfterSync = lastSyncedAt && masterUpdatedAt && masterUpdatedAt > lastSyncedAt;
const differentShipModified = lastSyncedBy !== shipId;

// Case 2: Master admin directly edited after last sync
const masterAdminEdited = masterDirectEdit?.editedBy === 'master-admin' &&
  lastSyncedAt && masterDirectEdit.editedAt > lastSyncedAt;

const hasConflict = (masterModifiedAfterSync && differentShipModified) || masterAdminEdited;
const conflictType = masterAdminEdited ? 'master-admin-edit' : 'concurrent-edit';
```

**i18n/Locale-Aware Conflict Detection:**
- ✅ Each locale is checked independently
- ✅ Adding AR locale when EN exists = NO conflict
- ✅ Updating AR when someone else updated EN = NO conflict
- ✅ Updating same locale as another recent edit = CONFLICT

**Why Timestamp + Source-Based:**
- ✅ Simple and reliable (no distributed clocks needed)
- ✅ Works with standard database timestamps
- ✅ Accurate conflict attribution (admin vs ship)
- ✅ Prevents data loss automatically
- ✅ Multi-ship aware (tracks which ship made last sync)
- ✅ Locale-aware (new locales don't conflict)

**Conflict Resolution Strategies:**

1. **keep-ship**: Apply ship's version to master
2. **keep-master**: Keep master's version, discard ship's changes
3. **merge**: Manually combine both versions

**After Resolution:**
- Mapping timestamp is updated (`mapping.updatedAt = now()`)
- lastSyncedBy is updated to reflect who resolved
- Future syncs won't conflict (unless master edits again)

```
┌──────┐     ┌────────┐     ┌─────────┐     ┌──────────┐     ┌──────────┐
│ Ship │     │ Master │     │Conflict │     │ Mapping  │     │  Admin   │
└──┬───┘     └───┬────┘     │Resolver │     └────┬─────┘     └────┬─────┘
   │             │          └────┬────┘          │                │
   │ update doc  │               │               │                │
   │────────────►│               │               │                │
   │             │               │               │                │
   │             │ getMapping()  │               │                │
   │             │───────────────┼──────────────►│                │
   │             │               │               │                │
   │             │◄──────────────┼───────────────│                │
   │             │  mapping.updatedAt            │                │
   │             │               │               │                │
   │             │ check master.updatedAt        │                │
   │             │ > mapping.updatedAt?          │                │
   │             │               │               │                │
   │             │ CONFLICT!     │               │                │
   │             │               │               │                │
   │             │ logConflict() │               │                │
   │             │──────────────►│               │                │
   │             │               │               │                │
   │             │               │ store         │                │
   │             │               │──────────────►│                │
   │             │               │               │                │
   │             │               │               │                │
   │             │               │               │   GET /conflicts
   │             │               │               │◄───────────────│
   │             │               │               │                │
   │             │               │               │   list         │
   │             │               │◄──────────────┼────────────────│
   │             │               │               │                │
   │             │               │   resolve()   │                │
   │             │               │◄──────────────┼────────────────│
   │             │               │               │                │
   │             │  update doc   │               │                │
   │             │◄──────────────│               │                │
   │             │               │               │                │
   │             │               │ update map    │                │
   │             │               │──────────────►│                │
   │             │               │               │                │
```

---

## 8. Error Handling

### 8.1 Error Categories

| Category | Examples | Handling |
|----------|----------|----------|
| **Network Errors** | Kafka unavailable, timeout | Queue locally, retry later |
| **Validation Errors** | Invalid content type, missing fields | Log warning, skip message |
| **Conflict Errors** | Concurrent edits | Log conflict, await admin |
| **Processing Errors** | DB errors, unexpected exceptions | Dead letter queue |

### 8.2 Dead Letter Queue Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                      DEAD LETTER QUEUE FLOW                           │
└──────────────────────────────────────────────────────────────────────┘

  ┌─────────────────┐
  │ Process Message │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ Error occurs    │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐          ┌─────────────────┐
  │ Add to Dead     │─────────►│ Dead Letter     │
  │ Letter Queue    │          │ status: pending │
  └─────────────────┘          └────────┬────────┘
                                        │
                                        ▼
                               ┌─────────────────┐
                               │ Retry Logic     │
                               │ (periodic job)  │
                               └────────┬────────┘
                                        │
                                ┌───────┴───────┐
                                │               │
                             SUCCESS         FAILED
                                │               │
                                ▼               ▼
                         ┌──────────┐   ┌─────────────┐
                         │ status:  │   │ retryCount++│
                         │ resolved │   └──────┬──────┘
                         └──────────┘          │
                                               │
                                       ┌───────┴───────┐
                                       │               │
                                    < MAX          >= MAX
                                       │               │
                                       ▼               ▼
                                ┌──────────┐   ┌─────────────┐
                                │ status:  │   │ status:     │
                                │ retrying │   │ exhausted   │
                                └──────────┘   │ (manual fix)│
                                               └─────────────┘
```

### 8.3 Retry Policy

| Attempt | Delay | Action |
|---------|-------|--------|
| 1 | Immediate | First try |
| 2 | 5 seconds | Retry |
| 3 | 30 seconds | Retry |
| 4+ | - | Mark exhausted |

---

## 9. Security Design

### 9.1 Data Security

| Aspect | Implementation |
|--------|----------------|
| **Sensitive Data** | Stripped before sync (passwords, tokens) |
| **Transport** | Kafka SSL/TLS encryption |
| **Authentication** | Kafka SASL (SCRAM-SHA-256) |
| **Authorization** | API routes (currently open - TODO) |

### 9.2 Sensitive Fields Stripped

```typescript
const SENSITIVE_FIELDS = [
  'password',
  'resetPasswordToken',
  'confirmationToken',
  'registrationToken',
  'token',
  'secret',
  'apiKey',
];
```

### 9.3 Security Recommendations

1. **Enable API Authentication** - Add auth to all sync/conflict routes
2. **Use SSL for Kafka** - Enable `KAFKA_SSL_ENABLED=true`
3. **Use SASL Authentication** - Configure Kafka SASL credentials
4. **Network Isolation** - Use VPN/private networks for Kafka
5. **Audit Logging** - Log all conflict resolutions

---

## 10. Performance Considerations

### 10.1 Optimization Strategies

| Strategy | Implementation |
|----------|----------------|
| **Debouncing** | 1 second delay before push (configurable) |
| **Batching** | Process up to 100 messages per batch |
| **Idempotent Producer** | Kafka producer with idempotent=true |
| **Indexed Queries** | Proper indexes on all lookup fields |
| **Connection Pooling** | Reuse Kafka connections |

### 10.2 Resource Usage

| Resource | Configuration |
|----------|---------------|
| **Kafka Consumer** | sessionTimeout: 10s, heartbeatInterval: 3s |
| **Message Retention** | 7 days for processed messages |
| **Dead Letter Retention** | 30 days for resolved entries |
| **Cleanup Interval** | Every 5 minutes |

### 10.3 Scalability Limits

| Metric | Limit | Notes |
|--------|-------|-------|
| Ships per Master | ~100 | Kafka consumer group limitation |
| Messages per second | ~1000 | Depends on Kafka cluster |
| Pending queue size | 10000 | Configurable warning threshold |
| Conflict resolution | Manual | Admin bottleneck |

---

## Changelog

### Version 1.2 (January 2026)

**Updates:**
- ✅ Added **Full i18n/Locale Support** in SyncMessage and data flows
- ✅ Added **Master Sync Queue** service interface (`master-sync-queue.ts`)
- ✅ Added **Master Edit Log** for tracking admin edits and conflict attribution
- ✅ Added **Locale-aware Conflict Detection** - each locale checked independently
- ✅ Added **New Locale Detection** - bypasses conflict checks for new locales
- ✅ Updated **SyncMessage** with `locale` and `masterDocumentId` fields
- ✅ Updated **ConflictData** with `conflictType` enum and `locale` field
- ✅ Updated **DocumentMapping** with `lastSyncedBy` field for multi-ship tracking
- ✅ Enhanced conflict detection algorithm with source tracking

**Key Changes:**
- Locale-aware sync: EN and AR versions don't conflict with each other
- New locale detection: Adding AR to EN-only document doesn't conflict
- Conflict types: `concurrent-edit` vs `master-admin-edit`
- Edit source tracking: `lastSyncedBy` field tracks which ship made last sync
- Master offline handling: master_sync_queue for Kafka outages

### Version 1.1 (January 2025)

**Updates:**
- ✅ Added **Sync Queue** service interface (`sync-queue.ts`)
- ✅ Added **Connectivity Monitor** service interface (`connectivity-monitor.ts`)
- ✅ Added **Version Manager** service interface (`version-manager.ts`)
- ✅ Added **Ship Tracker** service interface (`ship-tracker.ts`)
- ✅ Added **Message Tracker** service interface (`message-tracker.ts`)
- ✅ Added **Dead Letter** service interface (`dead-letter.ts`)
- ✅ Updated conflict detection to **timestamp-based** algorithm
- ✅ Added **Offline Sync Flow** diagram showing queue mechanism
- ✅ Updated `sync_queue` table documentation with status flow
- ✅ Enhanced conflict resolution section with timestamp-based detection

**Key Changes:**
- All service interfaces now match actual implementation
- Conflict detection algorithm documented: `masterUpdatedAt > lastSyncedAt`
- Offline sync flow documented: queue → connectivity check → automatic push
- Database schema updated with actual status values

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **Master** | Central server that holds the authoritative data |
| **Replica** | Remote server (ship) that syncs with master |
| **Ship** | Synonym for Replica |
| **Document Mapping** | Association between replica and master document IDs |
| **Conflict** | When same document is modified on both master and replica |
| **Dead Letter** | Failed message awaiting manual intervention |
| **Idempotency** | Guarantee that same message is processed exactly once |
| **Locale** | Language-specific version of content (e.g., en, ar, fr) |
| **New Locale** | A locale that doesn't exist on master for a given document |
| **lastSyncedBy** | Track who made the last sync (master or specific ship) |
| **Master Edit Log** | Table tracking direct admin edits on master for conflict attribution |

---

## Appendix B: Configuration Reference

```env
# Mode
SYNC_MODE=master|replica
SYNC_SHIP_ID=ship-001

# Kafka
KAFKA_BROKERS=broker1:9092,broker2:9092
KAFKA_SSL_ENABLED=true
KAFKA_SASL_MECHANISM=scram-sha-256
KAFKA_SASL_USERNAME=user
KAFKA_SASL_PASSWORD=password
KAFKA_TOPIC_SHIP_UPDATES=ship-updates
KAFKA_TOPIC_MASTER_UPDATES=master-updates

# Sync Settings
SYNC_BATCH_SIZE=100
SYNC_RETRY_ATTEMPTS=3
SYNC_RETRY_DELAY=5000
SYNC_CONNECTIVITY_CHECK_INTERVAL=30000
SYNC_DEBOUNCE_MS=1000
SYNC_CONTENT_TYPES=api::article.article,api::product.product
```

---

*End of Low Level Design Document*

