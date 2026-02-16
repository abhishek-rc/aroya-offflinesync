export default [
  {
    method: 'GET',
    path: '/conflicts',
    handler: 'conflict.list',
    config: {
      auth: false,
      policies: [],
      middlewares: [],
    },
  },
  {
    method: 'GET',
    path: '/conflicts/:id',
    handler: 'conflict.get',
    config: {
      auth: false,
      policies: [],
      middlewares: [],
    },
  },
  {
    method: 'POST',
    path: '/conflicts/:id/resolve',
    handler: 'conflict.resolve',
    config: {
      auth: false,
      policies: [],
      middlewares: [],
    },
  },
];

