/**
 * Initial Sync Routes
 */

export default [
  {
    method: 'GET',
    path: '/initial-sync/status',
    handler: 'initial-sync.status',
    config: {
      policies: [],
      auth: false, // Disable auth for testing - enable in production!
    },
  },
  {
    method: 'POST',
    path: '/initial-sync/pull',
    handler: 'initial-sync.pull',
    config: {
      policies: [],
      auth: false, // Disable auth for testing - enable in production!
    },
  },
];

