export default ({ strapi }: { strapi: any }) => {
  let connectivityState = {
    isOnline: false,
    lastChecked: null as Date | null,
    lastSuccess: null as Date | null,
    lastFailure: null as Date | null,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
  };

  /**
   * Check network connectivity by pinging master
   */
  const checkConnectivity = async (): Promise<{
    isOnline: boolean;
    latency?: number;
    error?: string;
  }> => {
    const pluginConfig = strapi.plugin('offline-sync').config;
    const syncService = strapi.plugin('offline-sync').service('sync-service');

    if (!pluginConfig.masterUrl) {
      return {
        isOnline: false,
        error: 'Master URL not configured',
      };
    }

    const startTime = Date.now();

    try {
      // Try to reach master's status endpoint
      await syncService.isMasterOnline();

      const latency = Date.now() - startTime;
      const wasOffline = !connectivityState.isOnline;

      // Update connectivity state
      connectivityState = {
        isOnline: true,
        lastChecked: new Date(),
        lastSuccess: new Date(),
        lastFailure: connectivityState.lastFailure,
        consecutiveFailures: 0,
        consecutiveSuccesses: connectivityState.consecutiveSuccesses + 1,
      };

      // Log if we just came back online
      if (wasOffline) {
        strapi.log.info(
          `Network connectivity restored! Master is reachable (latency: ${latency}ms)`
        );
      }

      return {
        isOnline: true,
        latency,
      };
    } catch (error: any) {
      const wasOnline = connectivityState.isOnline;

      // Update connectivity state
      connectivityState = {
        isOnline: false,
        lastChecked: new Date(),
        lastSuccess: connectivityState.lastSuccess,
        lastFailure: new Date(),
        consecutiveFailures: connectivityState.consecutiveFailures + 1,
        consecutiveSuccesses: 0,
      };

      // Log if we just went offline
      if (wasOnline) {
        strapi.log.warn(
          `Network connectivity lost! Master is unreachable. Error: ${error.message || 'Connection timeout'}`
        );
      }

      return {
        isOnline: false,
        error: error.message || 'Connection timeout',
      };
    }
  };

  /**
   * Get current connectivity state
   */
  const getConnectivityState = () => {
    return {
      ...connectivityState,
      // Calculate time since last check
      timeSinceLastCheck: connectivityState.lastChecked
        ? Date.now() - connectivityState.lastChecked.getTime()
        : null,
      // Calculate time since last success
      timeSinceLastSuccess: connectivityState.lastSuccess
        ? Date.now() - connectivityState.lastSuccess.getTime()
        : null,
      // Calculate time since last failure
      timeSinceLastFailure: connectivityState.lastFailure
        ? Date.now() - connectivityState.lastFailure.getTime()
        : null,
    };
  };

  /**
   * Check if network is connected (cached result)
   */
  const isConnected = (): boolean => {
    return connectivityState.isOnline;
  };

  /**
   * Start connectivity monitoring
   */
  const startMonitoring = (interval: number = 30000): () => void => {
    const pluginConfig = strapi.plugin('offline-sync').config;

    if (pluginConfig.mode !== 'replica') {
      return () => { }; // No-op for master
    }

    strapi.log.info(
      `Starting connectivity monitoring (interval: ${interval}ms)`
    );

    // Initial check
    checkConnectivity();

    // Periodic checks
    const monitoringInterval = setInterval(async () => {
      await checkConnectivity();
    }, interval);

    // Return cleanup function
    return () => {
      clearInterval(monitoringInterval);
      strapi.log.info('Connectivity monitoring stopped');
    };
  };

  /**
   * Wait for connectivity with timeout
   */
  const waitForConnectivity = async (
    timeout: number = 60000,
    checkInterval: number = 5000
  ): Promise<boolean> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await checkConnectivity();

      if (result.isOnline) {
        return true;
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    return false;
  };

  // Return the service methods
  return {
    checkConnectivity,
    getConnectivityState,
    isConnected,
    startMonitoring,
    waitForConnectivity,
  };
};

