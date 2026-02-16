export default ({ strapi }: { strapi: any }) => {
  let isOnline = false;
  let wasOnline = false; // Track previous state for detecting reconnection
  let checkInterval: NodeJS.Timeout | null = null;
  let onReconnectCallback: (() => void) | null = null;

  return {
    /**
     * Start connectivity monitoring
     */
    async startMonitoring(interval: number = 30000): Promise<void> {
      if (checkInterval) {
        clearInterval(checkInterval);
      }

      // Do an initial connectivity check immediately
      await this.checkConnectivity();

      checkInterval = setInterval(async () => {
        await this.checkConnectivity();
      }, interval);

      strapi.log.info('Connectivity monitoring started');
    },

    /**
     * Stop connectivity monitoring
     */
    stopMonitoring(): void {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    },

    /**
     * Register a callback to be called when connectivity is restored
     */
    onReconnect(callback: () => void): void {
      onReconnectCallback = callback;
    },

    /**
     * Check connectivity to master
     */
    async checkConnectivity(): Promise<{ isOnline: boolean; wasReconnected: boolean; error?: string }> {
      // In Strapi 5, use strapi.config.get with plugin:: namespace
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'replica') {
        return { isOnline: true, wasReconnected: false };
      }

      try {
        const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');

        // Always try to connect/reconnect - the connect() method handles cleanup internally
        if (!kafkaProducer.isConnected()) {
          strapi.log.debug('[Connectivity] Kafka disconnected, attempting to reconnect...');
          try {
            await kafkaProducer.connect();
            strapi.log.info('[Connectivity] ✅ Kafka reconnected successfully');
          } catch (connectError: any) {
            strapi.log.debug(`[Connectivity] Reconnect attempt failed: ${connectError.message}`);
            isOnline = false;
            return { isOnline: false, wasReconnected: false, error: connectError.message };
          }
        }

        // Verify connection with health check
        const healthy = await kafkaProducer.healthCheck();

        if (!healthy) {
          // Health check failed, try to reconnect
          strapi.log.debug('[Connectivity] Health check failed, forcing reconnect...');
          try {
            await kafkaProducer.connect();
            isOnline = kafkaProducer.isConnected();
          } catch {
            isOnline = false;
          }
        } else {
          isOnline = true;
        }

        // Detect reconnection (was offline, now online)
        const wasReconnected = !wasOnline && isOnline;
        wasOnline = isOnline;

        // Call reconnect callback if we just reconnected
        if (wasReconnected && onReconnectCallback) {
          strapi.log.info('[Connectivity] 🔄 Reconnected to master!');
          try {
            onReconnectCallback();
          } catch (callbackError: any) {
            strapi.log.debug(`[Connectivity] Reconnect callback error: ${callbackError.message}`);
          }
        }

        return { isOnline, wasReconnected };
      } catch (error: any) {
        isOnline = false;
        strapi.log.debug(`[Connectivity] Check failed: ${error.message}`);
        return { isOnline: false, wasReconnected: false, error: error.message };
      }
    },

    /**
     * Get current connectivity status
     */
    isConnected(): boolean {
      return isOnline;
    },

    /**
     * Check if we recently reconnected
     */
    wasRecentlyOffline(): boolean {
      return !wasOnline && isOnline;
    },
  };
};

