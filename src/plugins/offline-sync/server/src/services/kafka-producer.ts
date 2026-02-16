import { Kafka, Producer, Admin } from 'kafkajs';

export default ({ strapi }: { strapi: any }) => {
  let kafka: Kafka | null = null;
  let producer: Producer | null = null;
  let admin: Admin | null = null;
  let isConnected = false;

  return {
    /**
     * Initialize and connect Kafka producer
     * Works in both replica (send to master) and master (send to ships) modes
     */
    async connect(): Promise<void> {
      const config = strapi.config.get('plugin::offline-sync', {});

      // Producer is needed in both modes for bi-directional sync
      const clientId = config.mode === 'master'
        ? 'master-producer'
        : `ship-${config.shipId}`;

      try {
        // If already connected, verify connection is healthy
        if (producer && isConnected) {
          try {
            // Quick health check
            if (admin) {
              await admin.listTopics();
              return; // Still connected
            }
          } catch {
            // Connection is stale, need to reconnect
            strapi.log.info('[Kafka] Connection stale, reconnecting...');
          }
        }

        // Clean up existing connections before reconnecting
        if (admin) {
          try { await admin.disconnect(); } catch { /* ignore */ }
          admin = null;
        }
        if (producer) {
          try { await producer.disconnect(); } catch { /* ignore */ }
          producer = null;
        }
        isConnected = false;

        // Create fresh Kafka instance
        kafka = new Kafka({
          clientId,
          brokers: config.kafka.brokers,
          ssl: config.kafka.ssl,
          sasl: config.kafka.sasl?.mechanism ? {
            mechanism: config.kafka.sasl.mechanism as any,
            username: config.kafka.sasl.username,
            password: config.kafka.sasl.password,
          } : undefined,
          connectionTimeout: 10000, // 10 second timeout
          requestTimeout: 30000,    // 30 second request timeout
        });

        producer = kafka.producer({
          retry: {
            retries: 5,
            initialRetryTime: 100,
            multiplier: 2,
          },
          maxInFlightRequests: 1,
          idempotent: true,
        });

        await producer.connect();

        // Also create admin client for health checks
        admin = kafka.admin();
        await admin.connect();

        isConnected = true;

        strapi.log.info(`✅ Kafka producer connected (${config.mode} mode)`);
      } catch (error: any) {
        isConnected = false;
        strapi.log.error(`Failed to connect Kafka producer: ${error.message}`);
        throw error;
      }
    },

    /**
     * Disconnect Kafka producer
     */
    async disconnect(): Promise<void> {
      if (admin) {
        try {
          await admin.disconnect();
        } catch (e) {
          // Ignore disconnect errors
        }
        admin = null;
      }
      if (producer) {
        try {
          await producer.disconnect();
        } catch (e) {
          // Ignore disconnect errors
        }
        producer = null;
      }
      isConnected = false;
      strapi.log.info('Kafka producer disconnected');
    },

    /**
     * Health check - actually tests if Kafka broker is reachable
     */
    async healthCheck(): Promise<boolean> {
      if (!kafka) {
        return false;
      }

      try {
        // Create a temporary admin client to fetch cluster metadata
        const tempAdmin = kafka.admin();
        await tempAdmin.connect();
        await tempAdmin.listTopics(); // This will fail if Kafka is down
        await tempAdmin.disconnect();
        return true;
      } catch (error: any) {
        strapi.log.debug(`Kafka health check failed: ${error.message}`);
        // Mark as disconnected since broker is unreachable
        isConnected = false;
        return false;
      }
    },

    /**
     * Send sync message to Kafka
     * Includes automatic retry with reconnection on failure
     */
    async send(message: {
      messageId: string;
      shipId: string;
      timestamp: string;
      operation: 'create' | 'update' | 'delete' | 'ack' | 'conflict';
      contentType: string;
      contentId: number;
      version: number;
      data: any;
      metadata?: any;
    }, topic?: string): Promise<any> {
      const config = strapi.config.get('plugin::offline-sync', {});
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1000;

      // Always try to reconnect if not connected
      if (!producer || !isConnected) {
        strapi.log.debug('[Kafka] Producer not connected, attempting to connect...');
        await this.connect();
      }

      if (!producer || !isConnected) {
        throw new Error('Kafka producer is disconnected - cannot send message');
      }

      // Determine topic based on mode and operation
      let targetTopic = topic;
      if (!targetTopic) {
        if (config.mode === 'replica') {
          targetTopic = config.kafka.topics.shipUpdates;
        } else {
          // Master sends to master-updates topic
          targetTopic = config.kafka.topics.masterUpdates;
        }
      }

      // Retry loop with exponential backoff
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await producer.send({
            topic: targetTopic as string,
            messages: [{
              key: message.shipId,
              value: JSON.stringify(message),
              headers: {
                'content-type': 'application/json',
                'ship-id': message.shipId,
              },
            }],
          });

          strapi.log.debug(`Message sent to Kafka topic ${targetTopic}: ${message.messageId}`);
          return result;
        } catch (error: any) {
          lastError = error;
          const isDisconnectError = error.message?.includes('disconnected') || 
                                     error.message?.includes('not connected') ||
                                     error.message?.includes('ECONNRESET');
          
          if (isDisconnectError && attempt < MAX_RETRIES) {
            strapi.log.warn(`[Kafka] Send failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}, retrying after reconnect...`);
            
            // Mark as disconnected and wait before retry
            isConnected = false;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            
            // Try to reconnect
            try {
              await this.connect();
            } catch (connectError: any) {
              strapi.log.debug(`[Kafka] Reconnect failed: ${connectError.message}`);
              continue; // Try next attempt anyway
            }
          } else {
            // Non-recoverable error or max retries reached
            break;
          }
        }
      }

      strapi.log.error(`Failed to send message to Kafka: ${lastError?.message}`);
      throw lastError;
    },

    /**
     * Send batch of messages
     * Includes automatic retry with reconnection on failure
     */
    async sendBatch(messages: any[]): Promise<any> {
      const config = strapi.config.get('plugin::offline-sync', {});
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1000;

      if (!producer || !isConnected) {
        await this.connect();
      }

      if (!producer) {
        throw new Error('Kafka producer not initialized');
      }

      const kafkaMessages = messages.map(msg => ({
        key: msg.shipId,
        value: JSON.stringify(msg),
        headers: {
          'content-type': 'application/json',
          'ship-id': msg.shipId,
        },
      }));

      // Retry loop with exponential backoff
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await producer.send({
            topic: config.kafka.topics.shipUpdates,
            messages: kafkaMessages,
          });

          strapi.log.debug(`Batch of ${messages.length} messages sent to Kafka`);
          return result;
        } catch (error: any) {
          lastError = error;
          const isDisconnectError = error.message?.includes('disconnected') || 
                                     error.message?.includes('not connected') ||
                                     error.message?.includes('ECONNRESET');
          
          if (isDisconnectError && attempt < MAX_RETRIES) {
            strapi.log.warn(`[Kafka] Batch send failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}, retrying after reconnect...`);
            
            // Mark as disconnected and wait before retry
            isConnected = false;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            
            // Try to reconnect
            try {
              await this.connect();
            } catch (connectError: any) {
              strapi.log.debug(`[Kafka] Reconnect failed: ${connectError.message}`);
              continue;
            }
          } else {
            break;
          }
        }
      }

      strapi.log.error(`Failed to send batch to Kafka: ${lastError?.message}`);
      throw lastError;
    },

    /**
     * Send mapping acknowledgment to master (replica mode only)
     * Called when replica creates a local copy of a master document
     * This tells master: "My replicaDocId corresponds to your masterDocId"
     */
    async sendMappingAck(ack: {
      contentType: string;
      replicaDocumentId: string;
      masterDocumentId: string;
    }): Promise<boolean> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'replica') {
        strapi.log.warn('[Sync] sendMappingAck called in non-replica mode');
        return false;
      }

      if (!producer || !isConnected) {
        await this.connect();
      }

      if (!producer) {
        strapi.log.error('[Sync] Kafka producer not initialized');
        return false;
      }

      try {
        const topic = config.kafka.topics.shipUpdates;

        const message = {
          messageId: `mapping-ack-${config.shipId}-${Date.now()}`,
          shipId: config.shipId,
          timestamp: new Date().toISOString(),
          operation: 'mapping-ack',
          contentType: ack.contentType,
          replicaDocumentId: ack.replicaDocumentId,
          masterDocumentId: ack.masterDocumentId,
        };

        await producer.send({
          topic,
          messages: [{
            key: config.shipId,
            value: JSON.stringify(message),
            headers: {
              'content-type': 'application/json',
              'ship-id': config.shipId,
              'message-type': 'mapping-ack',
            },
          }],
        });

        strapi.log.info(`[Sync] 📤 Sent mapping ACK: ${ack.replicaDocumentId} → ${ack.masterDocumentId}`);
        return true;
      } catch (error: any) {
        strapi.log.error(`[Sync] Failed to send mapping ACK: ${error.message}`);
        return false;
      }
    },

    /**
     * Send heartbeat to master
     * Production-ready: uses existing Kafka infrastructure, lightweight payload
     */
    async sendHeartbeat(): Promise<boolean> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'replica' || !producer || !isConnected) {
        return false;
      }

      try {
        await producer.send({
          topic: config.kafka.topics.shipUpdates,
          messages: [{
            key: config.shipId,
            value: JSON.stringify({
              messageId: `heartbeat-${config.shipId}-${Date.now()}`,
              shipId: config.shipId,
              timestamp: new Date().toISOString(),
              operation: 'heartbeat',
            }),
            headers: {
              'content-type': 'application/json',
              'ship-id': config.shipId,
              'message-type': 'heartbeat',
            },
          }],
        });
        return true;
      } catch (error: any) {
        strapi.log.debug(`[Heartbeat] Send failed: ${error.message}`);
        return false;
      }
    },

    /**
     * Check if producer is connected
     */
    isConnected(): boolean {
      return isConnected;
    },

    /**
     * Send create acknowledgment to a specific ship (master mode only)
     * Called when master creates a document from ship's CREATE operation
     * This tells the ship: "Your replicaDocId R001 is now my masterDocId M001"
     */
    async sendCreateAck(ack: {
      shipId: string;
      contentType: string;
      replicaDocumentId: string;
      masterDocumentId: string;
      locale?: string | null;
    }): Promise<boolean> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'master') {
        strapi.log.warn('[Sync] sendCreateAck called in non-master mode');
        return false;
      }

      if (!producer || !isConnected) {
        await this.connect();
      }

      if (!producer) {
        strapi.log.error('[Sync] Kafka producer not initialized');
        return false;
      }

      try {
        const topic = config.kafka.topics?.masterUpdates || 'master-updates';

        const message: any = {
          messageId: `create-ack-${ack.shipId}-${Date.now()}`,
          shipId: ack.shipId,
          timestamp: new Date().toISOString(),
          operation: 'create-ack',
          contentType: ack.contentType,
          replicaDocumentId: ack.replicaDocumentId,
          masterDocumentId: ack.masterDocumentId,
        };
        
        // Include locale for i18n support
        if (ack.locale) {
          message.locale = ack.locale;
        }

        await producer.send({
          topic,
          messages: [{
            key: ack.shipId, // Route to specific ship
            value: JSON.stringify(message),
            headers: {
              'content-type': 'application/json',
              'source': 'master',
              'operation': 'create-ack',
              'target-ship': ack.shipId,
            },
          }],
        });

        strapi.log.info(`[Sync] 📤 Sent create ACK to ${ack.shipId}: ${ack.replicaDocumentId} → ${ack.masterDocumentId}`);
        return true;
      } catch (error: any) {
        strapi.log.error(`[Sync] Failed to send create ACK: ${error.message}`);
        return false;
      }
    },

    /**
     * Send conflict notification to a specific ship (master mode only)
     * Called when master rejects a ship's update due to conflict
     */
    async sendConflictNotification(notification: {
      shipId: string;
      contentType: string;
      contentId: string;
      replicaDocumentId: string;
      conflictId: number;
      reason: string;
      masterData: any;
      shipData: any;
      queueId?: number;
    }): Promise<boolean> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'master') {
        strapi.log.warn('[Sync] sendConflictNotification called in non-master mode');
        return false;
      }

      if (!producer || !isConnected) {
        await this.connect();
      }

      if (!producer) {
        strapi.log.error('[Sync] Kafka producer not initialized');
        return false;
      }

      try {
        const topic = config.kafka.topics?.masterUpdates || 'master-updates';

        const message = {
          messageId: `conflict-${notification.conflictId}-${Date.now()}`,
          shipId: notification.shipId,
          timestamp: new Date().toISOString(),
          operation: 'conflict-rejected',
          contentType: notification.contentType,
          contentId: notification.contentId,
          replicaDocumentId: notification.replicaDocumentId,
          conflictId: notification.conflictId,
          reason: notification.reason,
          masterData: notification.masterData,
          shipData: notification.shipData,
          queueId: notification.queueId,
        };

        await producer.send({
          topic,
          messages: [{
            key: notification.shipId, // Route to specific ship
            value: JSON.stringify(message),
            headers: {
              'content-type': 'application/json',
              'source': 'master',
              'operation': 'conflict-rejected',
              'target-ship': notification.shipId,
            },
          }],
        });

        strapi.log.info(`[Sync] ⚠️ Sent conflict notification to ${notification.shipId}: ${notification.contentType}/${notification.contentId}`);
        return true;
      } catch (error: any) {
        strapi.log.error(`[Sync] Failed to send conflict notification: ${error.message}`);
        return false;
      }
    },

    /**
     * Send message to ships (master mode only)
     * Used for bi-directional sync: master pushes updates to all ships
     */
    async sendToShips(message: {
      messageId: string;
      shipId: string;
      timestamp: string;
      operation: 'create' | 'update' | 'delete';
      contentType: string;
      contentId: string;
      version: number;
      data: any;
    }): Promise<boolean> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'master') {
        strapi.log.warn('[Sync] sendToShips called in non-master mode');
        return false;
      }

      if (!producer || !isConnected) {
        await this.connect();
      }

      if (!producer) {
        strapi.log.error('[Sync] Kafka producer not initialized');
        return false;
      }

      try {
        // Use master-updates topic for master→ship communication
        const topic = config.kafka.topics?.masterUpdates || 'master-updates';

        await producer.send({
          topic,
          messages: [{
            key: message.contentId,
            value: JSON.stringify(message),
            headers: {
              'content-type': 'application/json',
              'source': 'master',
              'operation': message.operation,
            },
          }],
        });

        strapi.log.debug(`[Sync] 📤 Sent to ships: ${message.operation} ${message.contentType}/${message.contentId}`);
        return true;
      } catch (error: any) {
        strapi.log.error(`[Sync] Failed to send to ships: ${error.message}`);
        return false;
      }
    },
  };
};

