/**
 * Health Check Routes
 * 
 * Endpoints:
 * - GET /api/offline-sync/health/live   - Liveness probe (is process running?)
 * - GET /api/offline-sync/health/ready  - Readiness probe (can accept traffic?)
 * - GET /api/offline-sync/health        - Detailed health status
 * - GET /api/offline-sync/metrics       - Prometheus metrics
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/health/live',
      handler: 'health.liveness',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/health/ready',
      handler: 'health.readiness',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/health',
      handler: 'health.health',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/metrics',
      handler: 'health.metrics',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};

