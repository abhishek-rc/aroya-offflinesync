export default {
  routes: [
    {
      method: 'POST',
      path: '/sync/push',
      handler: 'sync.push',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/sync/pull',
      handler: 'sync.pull',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/sync/status',
      handler: 'sync.status',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/sync/sync',
      handler: 'sync.manualSync',
      config: {
        policies: [],
      },
    },
  ],
};

