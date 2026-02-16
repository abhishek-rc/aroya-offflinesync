import schema from './schema';

export default {
  default: {
    enabled: true,
    mode: process.env.SYNC_MODE || 'replica',
    shipId: process.env.SYNC_SHIP_ID || null,
    kafka: {
      brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
      ssl: process.env.KAFKA_SSL_ENABLED === 'true',
      sasl: {
        mechanism: process.env.KAFKA_SASL_MECHANISM || null,
        username: process.env.KAFKA_SASL_USERNAME || null,
        password: process.env.KAFKA_SASL_PASSWORD || null,
      },
      topics: {
        shipUpdates: process.env.KAFKA_TOPIC_SHIP_UPDATES || 'ship-updates',
        masterUpdates: process.env.KAFKA_TOPIC_MASTER_UPDATES || 'master-updates',
      },
    },
    sync: {
      batchSize: parseInt(process.env.SYNC_BATCH_SIZE || '100'),
      retryAttempts: parseInt(process.env.SYNC_RETRY_ATTEMPTS || '3'),
      retryDelay: parseInt(process.env.SYNC_RETRY_DELAY || '5000'),
      connectivityCheckInterval: parseInt(process.env.SYNC_CONNECTIVITY_CHECK_INTERVAL || '30000'),
    },
    contentTypes: process.env.SYNC_CONTENT_TYPES?.split(',').filter(Boolean) || [],
  },
  validator: (config: any) => {
    if (config.mode && !['master', 'replica'].includes(config.mode)) {
      throw new Error('mode must be either "master" or "replica"');
    }
    if (config.mode === 'replica' && !config.shipId) {
      throw new Error('shipId is required when mode is "replica"');
    }
  },
  schema,
};

