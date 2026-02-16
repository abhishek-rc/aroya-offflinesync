export default [
  {
    method: 'GET',
    path: '/status',
    handler: 'sync.getStatus',
    config: {
      auth: false,
      policies: [],
      middlewares: [],
    },
  },
  {
    method: 'POST',
    path: '/push',
    handler: 'sync.push',
    config: {
      auth: false,
      policies: [],
      middlewares: [],
    },
  },
  {
    method: 'POST',
    path: '/pull',
    handler: 'sync.pull',
    config: {
      auth: false,
      policies: [],
      middlewares: [],
    },
  },
  {
    method: 'GET',
    path: '/queue',
    handler: 'sync.getQueue',
    config: {
      auth: false,
      policies: [],
      middlewares: [],
    },
  },
  {
    method: 'GET',
    path: '/queue/pending',
    handler: 'sync.getPending',
    config: {
      auth: false,
      policies: [],
      middlewares: [],
    },
  },
  {
    method: 'GET',
    path: '/ships',
    handler: 'sync.getShips',
    config: {
      auth: false,
      policies: [],
      middlewares: [],
    },
  },
];

