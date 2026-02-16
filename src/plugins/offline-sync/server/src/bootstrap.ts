/**
 * Offline Sync Plugin Bootstrap
 * Production-ready initialization for master/replica sync system
 */

// Types
interface PluginConfig {
  mode: 'master' | 'replica';
  shipId?: string;
  kafka: {
    brokers: string[];
    ssl: boolean;
    sasl: {
      mechanism?: string;
      username?: string;
      password?: string;
    };
    topics: {
      shipUpdates: string;
      masterUpdates: string;
    };
  };
  sync: {
    batchSize: number;
    retryAttempts: number;
    retryDelay: number;
    connectivityCheckInterval: number;
    autoPushInterval?: number;
    debounceMs?: number;
  };
  contentTypes: string[];
}

interface SyncContext {
  action: string;
  uid: string;
  params?: {
    documentId?: string;
  };
}

// Sensitive fields to strip from sync data
const SENSITIVE_FIELDS = [
  'password',
  'resetPasswordToken',
  'confirmationToken',
  'registrationToken',
  'token',
  'secret',
  'apiKey',
];

/**
 * Strip sensitive fields from object recursively
 */
function stripSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => stripSensitiveData(item));
  }

  const stripped: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      stripped[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      stripped[key] = stripSensitiveData(value);
    } else {
      stripped[key] = value;
    }
  }
  return stripped;
}

/**
 * Validate plugin configuration
 */
function validateConfig(config: PluginConfig, strapi: any): void {
  if (!config.mode) {
    throw new Error('[OfflineSync] SYNC_MODE is required (master or replica)');
  }

  if (!['master', 'replica'].includes(config.mode)) {
    throw new Error(`[OfflineSync] Invalid SYNC_MODE: ${config.mode}. Must be 'master' or 'replica'`);
  }

  if (config.mode === 'replica' && !config.shipId) {
    throw new Error('[OfflineSync] SYNC_SHIP_ID is required for replica mode');
  }

  if (!config.kafka?.brokers?.length) {
    strapi.log.warn('[OfflineSync] No Kafka brokers configured - sync will be disabled');
  }
}

/**
 * Create debounced function
 */
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export default ({ strapi }: { strapi: any }) => {
  // Get and validate plugin config
  const pluginConfig: PluginConfig = strapi.config.get('plugin::offline-sync', {});

  // Flags to prevent sync loops
  // _offlineSyncFromMaster: set during processMasterUpdate to prevent replica re-pushing received updates
  // _offlineSyncFromShip: set during processShipUpdate to prevent master re-broadcasting to ships
  (strapi as any)._offlineSyncFromMaster = false;
  (strapi as any)._offlineSyncFromShip = false;

  try {
    validateConfig(pluginConfig, strapi);
  } catch (error: any) {
    strapi.log.error(error.message);
    return; // Don't initialize if config is invalid
  }

  strapi.log.info('🚀 Offline Sync plugin initialized');
  strapi.log.info(`📡 Sync mode: ${pluginConfig.mode}`);

  // Store cleanup functions for graceful shutdown
  const cleanupFunctions: Array<() => Promise<void> | void> = [];

  if (pluginConfig.mode === 'replica') {
    strapi.log.info(`🚢 Ship ID: ${pluginConfig.shipId}`);

    // Initialize Kafka producer for replica (sends to master)
    const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
    kafkaProducer.connect().catch((error: any) => {
      strapi.log.warn(`Kafka producer connection deferred: ${error.message}`);
    });

    // Add producer disconnect to cleanup
    cleanupFunctions.push(async () => {
      try {
        await kafkaProducer.disconnect();
        strapi.log.info('[OfflineSync] Kafka producer disconnected');
      } catch (e) {
        // Ignore disconnect errors
      }
    });

    // Initialize Kafka consumer for replica (receives master updates for bi-directional sync)
    const kafkaConsumer = strapi.plugin('offline-sync').service('kafka-consumer');
    kafkaConsumer.connect().catch((error: any) => {
      strapi.log.warn(`Kafka consumer connection deferred: ${error.message}`);
    });

    // Add consumer disconnect to cleanup
    cleanupFunctions.push(async () => {
      try {
        await kafkaConsumer.disconnect();
        strapi.log.info('[OfflineSync] Kafka consumer disconnected');
      } catch (e) {
        // Ignore disconnect errors
      }
    });

    // Initialize Media Sync (OSS → MinIO) if enabled
    const mediaSync = strapi.plugin('offline-sync').service('media-sync');
    if (mediaSync.isEnabled()) {
      strapi.log.info('[OfflineSync] 🖼️ Media sync enabled');
      mediaSync.initialize().catch((error: any) => {
        strapi.log.warn(`[OfflineSync] Media sync initialization deferred: ${error.message}`);
      });

      // Add media sync shutdown to cleanup
      cleanupFunctions.push(async () => {
        try {
          await mediaSync.shutdown();
          strapi.log.info('[OfflineSync] Media sync stopped');
        } catch (e) {
          // Ignore shutdown errors
        }
      });
    }

    // Start connectivity monitoring
    const connectivityMonitor = strapi.plugin('offline-sync').service('connectivity-monitor');
    connectivityMonitor.startMonitoring(pluginConfig.sync.connectivityCheckInterval);

    // Register reconnection callback for push after connection stabilizes
    connectivityMonitor.onReconnect(async () => {
      strapi.log.info('[OfflineSync] 🔄 Connection restored - waiting for stabilization...');
      
      // Use setTimeout to:
      // 1. Avoid blocking the connectivity check
      // 2. Give the Kafka connection time to fully stabilize before pushing
      const STABILIZATION_DELAY_MS = 3000; // 3 seconds to stabilize
      
      setTimeout(async () => {
        try {
          const syncService = strapi.plugin('offline-sync').service('sync-service');
          const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
          const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');

          // Verify connection is still stable after delay
          if (!kafkaProducer.isConnected()) {
            strapi.log.warn('[OfflineSync] Connection unstable after stabilization delay, skipping push');
            return;
          }

          const pendingCount = await syncQueue.getPending(pluginConfig.shipId);
          if (pendingCount > 0) {
            strapi.log.info(`[OfflineSync] 📤 Pushing ${pendingCount} pending items after reconnection...`);
            const result = await syncService.push();
            strapi.log.info(`[OfflineSync] ✅ Reconnection push complete: ${result.pushed} pushed, ${result.failed} failed`);
          } else {
            strapi.log.info('[OfflineSync] No pending items to push after reconnection');
          }
        } catch (error: any) {
          strapi.log.error(`[OfflineSync] Reconnection push error: ${error.message}`);
        }
      }, STABILIZATION_DELAY_MS);
    });

    // Add monitor stop to cleanup
    cleanupFunctions.push(() => {
      connectivityMonitor.stopMonitoring();
      strapi.log.info('[OfflineSync] Connectivity monitoring stopped');
    });

    // Instant push state
    let isPushing = false;
    let pushQueue = 0;

    /**
     * Push pending items to Kafka
     * Rate-limited and debounced for production
     */
    const executePush = async () => {
      if (isPushing) {
        pushQueue++;
        return;
      }

      try {
        isPushing = true;
        const syncService = strapi.plugin('offline-sync').service('sync-service');
        const syncQueue = strapi.plugin('offline-sync').service('sync-queue');

        // Check if there are pending items
        const pendingCount = await syncQueue.getPending(pluginConfig.shipId);
        if (pendingCount === 0) return;

        // Check connectivity
        const { isOnline } = await connectivityMonitor.checkConnectivity();
        if (!isOnline) {
          strapi.log.debug(`[InstantSync] Offline - ${pendingCount} items queued`);
          return;
        }

        strapi.log.info(`[InstantSync] 🔄 Pushing ${pendingCount} items to Kafka...`);
        const result = await syncService.push();
        strapi.log.info(`[InstantSync] ✅ Pushed ${result.pushed} items, ${result.failed} failed`);
      } catch (error: any) {
        strapi.log.error(`[InstantSync] Push error: ${error.message}`);
      } finally {
        isPushing = false;

        // Process queued pushes
        if (pushQueue > 0) {
          pushQueue = 0;
          setImmediate(executePush);
        }
      }
    };

    // Debounce to prevent rapid-fire pushes (default 1 second)
    const debounceMs = pluginConfig.sync.debounceMs || 1000;
    const debouncedPush = debounce(executePush, debounceMs);

    // Store push function for document middleware
    (strapi as any).offlineSyncPush = debouncedPush;
    strapi.log.info(`[InstantSync] Enabled (debounce: ${debounceMs}ms)`);

    // Heartbeat mechanism - sends periodic status to master
    // Interval: 60 seconds (production-ready, not too frequent)
    const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 60 seconds
    let heartbeatIntervalId: NodeJS.Timeout | null = null;

    const startHeartbeat = () => {
      // Send initial heartbeat after Kafka connects
      setTimeout(async () => {
        try {
          const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
          if (kafkaProducer.isConnected()) {
            await kafkaProducer.sendHeartbeat();
            strapi.log.info(`[Heartbeat] 💓 Started (interval: ${HEARTBEAT_INTERVAL_MS / 1000}s)`);
          }
        } catch (e) {
          // Ignore initial heartbeat failure
        }
      }, 5000); // Wait 5s for Kafka to connect

      // Schedule periodic heartbeats
      heartbeatIntervalId = setInterval(async () => {
        try {
          const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
          if (kafkaProducer.isConnected()) {
            await kafkaProducer.sendHeartbeat();
          }
        } catch (e) {
          // Heartbeat failures are non-critical, silently ignore
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    startHeartbeat();

    // Add heartbeat cleanup
    cleanupFunctions.push(() => {
      if (heartbeatIntervalId) {
        clearInterval(heartbeatIntervalId);
        heartbeatIntervalId = null;
      }
    });

    // ========================================================
    // AUTO-PUSH: Periodic check for pending items + push on reconnect
    // This fixes the issue where pending items aren't pushed
    // until new changes are made
    // ========================================================
    const AUTO_PUSH_INTERVAL_MS = pluginConfig.sync.autoPushInterval || 30000; // Default 30 seconds
    let autoPushIntervalId: NodeJS.Timeout | null = null;
    let wasOffline = false; // Track previous connectivity state

    const autoPushCheck = async () => {
      try {
        const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
        const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');

        // Check if there are pending items
        const pendingItems = await syncQueue.getPending(pluginConfig.shipId);
        if (pendingItems === 0) {
          return; // Nothing to push
        }

        // Check connectivity
        const { isOnline, wasReconnected } = await connectivityMonitor.checkConnectivity();

        if (isOnline) {
          // If we just reconnected, wait for connection to stabilize
          if (wasReconnected || wasOffline) {
            strapi.log.info(`[AutoPush] 🔄 Reconnected! Waiting for connection to stabilize...`);
            wasOffline = false;
            
            // Wait for stabilization before pushing
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Verify still connected after delay
            if (!kafkaProducer.isConnected()) {
              strapi.log.warn(`[AutoPush] Connection unstable, skipping push`);
              return;
            }
            
            strapi.log.info(`[AutoPush] Connection stable. Found ${pendingItems} pending items to push`);
          }

          // Push pending items
          strapi.log.info(`[AutoPush] 📤 Pushing ${pendingItems} pending items...`);
          await executePush();
        } else {
          // Track that we're offline
          if (!wasOffline) {
            strapi.log.info(`[AutoPush] 📴 Offline - ${pendingItems} items queued for later`);
            wasOffline = true;
          }
        }
      } catch (error: any) {
        strapi.log.debug(`[AutoPush] Check error: ${error.message}`);
      }
    };

    // Start auto-push interval
    const startAutoPush = () => {
      // Do an initial check after startup (wait for Kafka to connect)
      setTimeout(async () => {
        await autoPushCheck();
      }, 10000); // Wait 10s after startup

      // Schedule periodic checks
      autoPushIntervalId = setInterval(autoPushCheck, AUTO_PUSH_INTERVAL_MS);
      strapi.log.info(`[AutoPush] ✅ Enabled (interval: ${AUTO_PUSH_INTERVAL_MS / 1000}s)`);
    };

    startAutoPush();

    // Add auto-push cleanup
    cleanupFunctions.push(() => {
      if (autoPushIntervalId) {
        clearInterval(autoPushIntervalId);
        autoPushIntervalId = null;
      }
    });

  } else {
    // MASTER MODE
    // Using Strapi content types - no database timing issues

    let kafkaConsumer: ReturnType<typeof strapi.plugin> | null = null;
    let cleanupIntervalId: NodeJS.Timeout | null = null;
    let masterAutoPushIntervalId: NodeJS.Timeout | null = null;
    let isShuttingDown = false;
    let masterWasOffline = false;

    // Initialize Kafka producer (for bi-directional sync: master → ships)
    const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
    const masterSyncQueue = strapi.plugin('offline-sync').service('master-sync-queue');

    kafkaProducer.connect()
      .then(() => {
        strapi.log.info('[OfflineSync] ✅ Kafka producer connected (master mode)');
      })
      .catch((error: any) => {
        strapi.log.warn(`[OfflineSync] Kafka producer connection deferred: ${error.message}`);
      });

    // Add producer disconnect to cleanup
    cleanupFunctions.push(async () => {
      try {
        await kafkaProducer.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    });

    // ========================================================
    // MASTER AUTO-PUSH: Push queued changes when Kafka reconnects
    // ========================================================
    const MASTER_AUTO_PUSH_INTERVAL_MS = 30000; // Check every 30 seconds

    const masterAutoPushCheck = async () => {
      if (isShuttingDown) return;

      try {
        // Check if there are pending items in Master queue
        const pendingCount = await masterSyncQueue.getPendingCount();

        if (pendingCount === 0) {
          return; // Nothing to push
        }

        // Check if Kafka is connected
        if (!kafkaProducer.isConnected()) {
          if (!masterWasOffline) {
            strapi.log.info(`[MasterAutoPush] 📴 Kafka offline - ${pendingCount} items queued`);
            masterWasOffline = true;
          }
          return;
        }

        // We're online, push pending items
        if (masterWasOffline) {
          strapi.log.info(`[MasterAutoPush] 🔄 Kafka reconnected! Pushing ${pendingCount} queued items...`);
          masterWasOffline = false;
        }

        // Dequeue and send pending items
        const pending = await masterSyncQueue.dequeue(50);
        let sent = 0;
        let failed = 0;

        for (const item of pending) {
          try {
            const message = {
              messageId: `master-queued-${Date.now()}-${item.content_id}`,
              shipId: 'master',
              timestamp: new Date().toISOString(),
              operation: item.operation,
              contentType: item.content_type,
              contentId: item.content_id,
              version: 0,
              data: item.data,
              locale: item.locale,
            };

            await kafkaProducer.sendToShips(message);
            await masterSyncQueue.markSent(item.id);
            sent++;
          } catch (error: any) {
            await masterSyncQueue.markFailed(item.id, error);
            failed++;
          }
        }

        if (sent > 0 || failed > 0) {
          strapi.log.info(`[MasterAutoPush] ✅ Pushed ${sent} items, ${failed} failed`);
        }
      } catch (error: any) {
        strapi.log.debug(`[MasterAutoPush] Check error: ${error.message}`);
      }
    };

    // Start Master auto-push interval
    const startMasterAutoPush = () => {
      // Initial check after startup
      setTimeout(async () => {
        await masterAutoPushCheck();
      }, 15000); // Wait 15s for Kafka to connect

      // Schedule periodic checks
      masterAutoPushIntervalId = setInterval(masterAutoPushCheck, MASTER_AUTO_PUSH_INTERVAL_MS);
      strapi.log.info(`[MasterAutoPush] ✅ Enabled (interval: ${MASTER_AUTO_PUSH_INTERVAL_MS / 1000}s)`);
    };

    startMasterAutoPush();

    // Initialize Kafka consumer (receives from ships)
    const kafkaService = strapi.plugin('offline-sync').service('kafka-consumer');
    kafkaService.connect()
      .then(() => {
        kafkaConsumer = kafkaService;
        strapi.log.info('[OfflineSync] ✅ Kafka consumer connected (master mode)');
      })
      .catch((error: Error) => {
        strapi.log.warn(`[OfflineSync] Kafka consumer connection deferred: ${error.message}`);
      });

    // Periodic cleanup tasks (every 5 minutes)
    cleanupIntervalId = setInterval(async () => {
      // Skip if shutting down or strapi is not available
      if (isShuttingDown) {
        return;
      }

      // Safely check if strapi and plugin are available
      if (!strapi?.plugin) {
        return;
      }

      try {
        const plugin = strapi.plugin('offline-sync');
        if (!plugin) return;

        // Mark stale ships as offline (2 minutes = 2 missed heartbeats)
        const shipTracker = plugin.service('ship-tracker');
        if (shipTracker?.markOfflineShips) {
          await shipTracker.markOfflineShips(2);
        }

        // Cleanup old processed messages (keep 7 days)
        const messageTracker = plugin.service('message-tracker');
        if (messageTracker?.cleanup) {
          await messageTracker.cleanup(7);
        }

        // Cleanup old resolved dead letters (keep 30 days)
        const deadLetter = plugin.service('dead-letter');
        if (deadLetter?.cleanup) {
          await deadLetter.cleanup(30);
        }

        // Cleanup old Master queue entries (keep 7 days)
        const masterQueue = plugin.service('master-sync-queue');
        if (masterQueue?.cleanup) {
          await masterQueue.cleanup(7);
        }
      } catch (error: unknown) {
        // Non-critical cleanup, silently ignore during shutdown
        if (!isShuttingDown && strapi?.log?.debug) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          strapi.log.debug(`[OfflineSync] Cleanup task: ${message}`);
        }
      }
    }, 300000); // 5 minutes

    // Cleanup function for graceful shutdown
    cleanupFunctions.push(async () => {
      isShuttingDown = true;

      if (masterAutoPushIntervalId) {
        clearInterval(masterAutoPushIntervalId);
        masterAutoPushIntervalId = null;
      }

      if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
        cleanupIntervalId = null;
      }

      if (kafkaConsumer) {
        try {
          await kafkaService.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
    });

    strapi.log.info('[OfflineSync] Master mode initialized');
  }

  // Register graceful shutdown
  const gracefulShutdown = async () => {
    // Set global shutdown flag so services know to skip operations
    (strapi as any)._isShuttingDown = true;

    strapi.log.info('[OfflineSync] Shutting down...');
    for (const cleanup of cleanupFunctions) {
      try {
        await cleanup();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    strapi.log.info('[OfflineSync] Shutdown complete');
  };

  // Register shutdown handlers
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Store shutdown function for manual cleanup
  (strapi as any).offlineSyncShutdown = gracefulShutdown;

  // Register Document Service middleware for Strapi 5
  strapi.documents.use(async (context: SyncContext, next: () => Promise<any>) => {
    const { action, uid } = context;

    // Skip plugin and admin content types BEFORE calling next()
    // This prevents potential circular references when our services use strapi.documents()
    if (!uid || uid.startsWith('plugin::') || uid.startsWith('admin::')) {
      return await next();
    }

    // IMPORTANT: Capture documentId from params BEFORE calling next()
    // This is critical for delete operations where result might be null
    const paramsDocumentId = (context.params as any)?.documentId;
    const paramsLocale = (context.params as any)?.locale || null;

    // Execute the action first
    const result = await next();

    // Wrap ALL our sync logic in try-catch - our middleware should NEVER cause errors
    try {

      // Filter by allowed content types if configured
      if (pluginConfig.contentTypes?.length > 0) {
        if (!pluginConfig.contentTypes.includes(uid)) {
          return result;
        }
      }

      // Only track specific actions
      const trackedActions = ['create', 'update', 'delete', 'publish'];
      if (!trackedActions.includes(action)) {
        return result;
      }

      // Get document ID - for DELETE, params is the primary source
      let documentId: string | undefined;

      // For delete, prioritize params.documentId (result might be null/empty)
      if (action === 'delete') {
        if (paramsDocumentId && typeof paramsDocumentId === 'string') {
          documentId = paramsDocumentId;
        } else if (result?.documentId && typeof result.documentId === 'string') {
          documentId = result.documentId;
        }
      } else {
        // For other actions, try result first, then params
        if (result?.documentId && typeof result.documentId === 'string') {
          documentId = result.documentId;
        } else if (result?.id && typeof result.id === 'string') {
          documentId = result.id;
        } else if (paramsDocumentId && typeof paramsDocumentId === 'string') {
          documentId = paramsDocumentId;
        }
      }

      // Skip if no valid documentId
      if (!documentId || typeof documentId !== 'string' || documentId.length === 0) {
        strapi.log.debug(`[Sync] Skipping ${action} for ${uid} - no valid documentId`);
        return result;
      }

      // Skip bulk operations (when result is an array or has count property)
      // But NOT for delete - delete with valid documentId should proceed
      if (action !== 'delete') {
        if (Array.isArray(result)) {
          strapi.log.debug(`[Sync] Skipping array result for ${uid}`);
          return result;
        }
        if (result && typeof result === 'object' && ('count' in result || 'deletedCount' in result || 'entries' in result)) {
          strapi.log.debug(`[Sync] Skipping bulk/count result for ${uid}`);
          return result;
        }
      }

      // Map action to operation
      let operation: 'create' | 'update' | 'delete' = 'update';
      if (action === 'create') operation = 'create';
      if (action === 'delete') operation = 'delete';

      // Capture locale for i18n support (use pre-captured paramsLocale or from result)
      const locale = paramsLocale || (result as any)?.locale || null;

      // For publish action, fetch full document data if result is incomplete
      let syncData = result;
      if (action === 'publish' && (!result || Object.keys(result).length < 3)) {
        try {
          syncData = await strapi.documents(uid).findOne({ documentId });
        } catch {
          // If fetch fails, use original result
        }
      }

      if (pluginConfig.mode === 'replica') {
        // REPLICA MODE: Queue changes to push to master

        // Skip if this change originated from master (prevents sync loop)
        if ((strapi as any)._offlineSyncFromMaster) {
          strapi.log.debug(`[Sync] Skipping queue for ${uid} (${documentId}) - originated from master`);
          return result;
        }

        try {
          const versionManager = strapi.plugin('offline-sync').service('version-manager');
          const syncQueue = strapi.plugin('offline-sync').service('sync-queue');

          // Increment version (skip for delete)
          const version = operation !== 'delete'
            ? await versionManager.incrementVersion(uid, documentId, pluginConfig.shipId)
            : 0;

          // Strip sensitive data before queuing
          const safeData = operation !== 'delete' ? stripSensitiveData(syncData) : null;

          await syncQueue.enqueue({
            shipId: pluginConfig.shipId!,
            contentType: uid,
            contentId: documentId,
            operation,
            localVersion: version,
            data: safeData,
            locale, // Include locale for i18n support
          });

          strapi.log.info(`[Sync] ✅ Queued ${operation} for ${uid} (${documentId})${locale ? ` [${locale}]` : ''}`);

          // Trigger instant push (debounced)
          if ((strapi as any).offlineSyncPush) {
            (strapi as any).offlineSyncPush();
          }
        } catch (error: any) {
          strapi.log.error(`[Sync] Queue error for ${action} ${uid}: ${error.message}`);
        }
      } else if (pluginConfig.mode === 'master') {
        // MASTER MODE: Publish changes to ships via Kafka

        // Skip if this change originated from a ship (prevents sync loop)
        // When master processes ship updates, it shouldn't broadcast them back
        if ((strapi as any)._offlineSyncFromShip) {
          strapi.log.debug(`[Sync] Skipping broadcast for ${uid} (${documentId}) - originated from ship`);
          return result;
        }

        try {
          const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
          const masterSyncQueue = strapi.plugin('offline-sync').service('master-sync-queue');

          const safeData = operation !== 'delete' ? stripSensitiveData(syncData) : null;

          // Log this edit as coming from Master admin (for conflict detection)
          // This helps distinguish Master direct edits from Ship syncs
          await masterSyncQueue.logEdit({
            contentType: uid,
            documentId,
            operation,
            editedBy: 'master-admin',
            locale,
          });

          // Try to publish directly if Kafka is connected
          if (kafkaProducer.isConnected()) {
            const message = {
              messageId: `master-${Date.now()}-${documentId}`,
              shipId: 'master',
              timestamp: new Date().toISOString(),
              operation,
              contentType: uid,
              contentId: documentId,
              version: 0,
              data: safeData,
              locale, // Include locale for i18n support
            };

            await kafkaProducer.sendToShips(message);
            strapi.log.info(`[Sync] 📤 Published ${operation} for ${uid} (${documentId})${locale ? ` [${locale}]` : ''} to ships`);
          } else {
            // Kafka offline - queue for later
            await masterSyncQueue.enqueue({
              contentType: uid,
              contentId: documentId,
              operation,
              data: safeData,
              locale,
            });
            strapi.log.info(`[Sync] 📥 Queued ${operation} for ${uid} (${documentId})${locale ? ` [${locale}]` : ''} (Kafka offline)`);
          }
        } catch (error: any) {
          // Non-critical, don't fail the operation
          strapi.log.debug(`[Sync] Failed to publish/queue to ships: ${error.message}`);
        }
      }
    } catch (syncError: any) {
      // Our sync logic failed - log but NEVER block the original operation
      strapi.log.debug(`[Sync] Sync processing error (non-blocking): ${syncError.message}`);
    }

    return result;
  });

  strapi.log.info('[Sync] Document Service middleware registered');
};

