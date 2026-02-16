export default {
  routes: [
    {
      method: 'GET',
      path: '/sync/conflicts',
      handler: 'conflict.list',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/sync/conflicts/:id',
      handler: 'conflict.getOne',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/sync/conflicts/:id/resolve',
      handler: 'conflict.resolve',
      config: {
        policies: [],
      },
    },
  ],
};

