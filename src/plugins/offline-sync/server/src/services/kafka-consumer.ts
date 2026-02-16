import { Kafka, Consumer } from 'kafkajs';

export default ({ strapi: strapiInstance }: { strapi: any }) => {
  // Capture strapi in closure to ensure it's always available
  const strapi = strapiInstance;
  let kafka: Kafka | null = null;
  let consumer: Consumer | null = null;
  let isConnected = false;

  /**
   * Process incoming sync message
   * Defined outside return to capture strapi in closure
   */
  const processMessage = async (message: any): Promise<void> => {
    if (!strapi) {
      console.error('[KafkaConsumer] Strapi instance not available');
      return;
    }

    const config = strapi.config.get('plugin::offline-sync', {});
    const { operation, shipId } = message;

    // Handle heartbeat messages (master mode only)
    if (operation === 'heartbeat') {
      if (config.mode === 'master') {
        try {
          const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');
          if (!shipTracker) {
            strapi.log.error('[Heartbeat] Ship tracker service not available');
            return;
          }
          
          const ship = await shipTracker.registerShip(shipId, shipId);
          if (ship) {
            strapi.log.info(`💓 Heartbeat from ${shipId} - ${ship.connectivityStatus}`);
          } else {
            strapi.log.warn(`💓 Heartbeat from ${shipId} - registration returned null`);
          }
        } catch (error: any) {
          const errorMsg = error?.message || 'Unknown error';
          strapi.log.error(`[Heartbeat] Failed to register/update ship ${shipId}: ${errorMsg}`);
          if (error?.stack) {
            strapi.log.error(`[Heartbeat] Error stack: ${error.stack}`);
          }
          // Don't throw - allow other messages to process
        }
      }
      return;
    }

    // Handle mapping acknowledgment (master mode only)
    if (operation === 'mapping-ack') {
      if (config.mode === 'master') {
        try {
          const syncService = strapi.plugin('offline-sync').service('sync-service');
          await syncService.handleMappingAck(message);
        } catch (error: any) {
          strapi.log.error(`[MappingAck] Failed to process: ${error.message}`);
        }
      }
      return;
    }

    const syncService = strapi.plugin('offline-sync').service('sync-service');

    if (config.mode === 'master') {
      // Master receives updates from ships
      strapi.log.info(`📨 Received sync message: ${message.messageId} from ${shipId}`);
      try {
        await syncService.processShipUpdate(message);
      } catch (error: any) {
        strapi.log.error(`Error processing ship update: ${error.message}`);
        throw error;
      }
    } else {
      // Replica receives updates from master
      strapi.log.info(`📥 Received master update: ${message.messageId}`);
      try {
        await syncService.processMasterUpdate(message);
      } catch (error: any) {
        strapi.log.error(`Error processing master update: ${error.message}`);
        throw error;
      }
    }
  };

  return {
    /**
     * Initialize and connect Kafka consumer
     * Works in both modes:
     * - Master: consumes ship-updates topic (receives from ships)
     * - Replica: consumes master-updates topic (receives from master)
     */
    async connect(): Promise<void> {
      const config = strapi.config.get('plugin::offline-sync', {});

      try {
        const clientId = config.mode === 'master'
          ? 'master-consumer'
          : `ship-${config.shipId}-consumer`;

        kafka = new Kafka({
          clientId,
          brokers: config.kafka.brokers,
          ssl: config.kafka.ssl,
          sasl: config.kafka.sasl?.mechanism ? {
            mechanism: config.kafka.sasl.mechanism as any,
            username: config.kafka.sasl.username,
            password: config.kafka.sasl.password,
          } : undefined,
        });

        // Use stable group ID for production
        // In development, set KAFKA_CONSUMER_GROUP_SUFFIX env var to avoid zombie consumers
        const groupSuffix = process.env.KAFKA_CONSUMER_GROUP_SUFFIX || '';
        const baseGroupId = config.mode === 'master'
          ? 'master-sync-consumer'
          : `ship-${config.shipId}-consumer`;
        const groupId = `${baseGroupId}${groupSuffix ? `-${groupSuffix}` : ''}`;

        consumer = kafka.consumer({
          groupId,
          sessionTimeout: 10000,
          heartbeatInterval: 3000,
        });

        strapi.log.info(`[Kafka] Consumer group: ${groupId}`);

        await consumer.connect();

        // Subscribe to appropriate topic based on mode
        const topic = config.mode === 'master'
          ? config.kafka.topics.shipUpdates
          : (config.kafka.topics?.masterUpdates || 'master-updates');

        await consumer.subscribe({
          topics: [topic],
          fromBeginning: false,
        });

        isConnected = true;
        strapi.log.info(`✅ Kafka consumer connected (${config.mode} mode)`);
        strapi.log.info(`📡 Subscribed to topic: ${topic}`);

        // Start consuming messages
        // processMessage is defined above and captures strapi in closure
        await consumer.run({
          eachMessage: async ({ topic, partition, message }) => {
            try {
              const syncMessage = JSON.parse(message.value?.toString() || '{}');
              await processMessage(syncMessage);
            } catch (error: any) {
              if (strapi && strapi.log) {
                strapi.log.error(`Error processing Kafka message: ${error.message}`);
              } else {
                console.error(`Error processing Kafka message: ${error.message}`);
              }
            }
          },
        });
      } catch (error: any) {
        strapi.log.error(`Failed to connect Kafka consumer: ${error.message}`);
        throw error;
      }
    },

    /**
     * Disconnect Kafka consumer
     */
    async disconnect(): Promise<void> {
      if (consumer && isConnected) {
        await consumer.disconnect();
        isConnected = false;
        strapi.log.info('Kafka consumer disconnected');
      }
    },

    /**
     * Process incoming sync message (exposed for testing)
     */
    processMessage,

    /**
     * Check if consumer is connected
     */
    isConnected(): boolean {
      return isConnected;
    },
  };
};

