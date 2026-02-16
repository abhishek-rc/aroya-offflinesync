/**
 * Media Sync Routes
 */

export default [
  {
    method: 'GET',
    path: '/media/stats',
    handler: 'media.stats',
    config: {
      policies: [],
      auth: false, // Allow without auth for monitoring
    },
  },
  {
    method: 'POST',
    path: '/media/sync',
    handler: 'media.triggerSync',
    config: {
      policies: [],
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/media/health',
    handler: 'media.health',
    config: {
      policies: [],
      auth: false,
    },
  },
];
