export default {
  default: {
    mode: 'replica', // 'master' or 'replica'
    shipId: null,
    masterUrl: null,
    syncInterval: 60000, // 1 minute
    autoSync: true,
    conflictStrategy: 'manual', // 'manual', 'auto-merge', 'last-write-wins'
    batchSize: 50,
    retryAttempts: 3,
    retryDelay: 5000,
  },
  validator: (config: any) => {
    if (config.mode && !['master', 'replica'].includes(config.mode)) {
      throw new Error('mode must be either "master" or "replica"');
    }
    if (config.mode === 'replica' && !config.masterUrl) {
      throw new Error('masterUrl is required when mode is "replica"');
    }
    if (config.mode === 'replica' && !config.shipId) {
      throw new Error('shipId is required when mode is "replica"');
    }
  },
};

