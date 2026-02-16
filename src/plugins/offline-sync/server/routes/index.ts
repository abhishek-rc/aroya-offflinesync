import sync from './sync';
import conflict from './conflict';

export default {
  routes: [
    ...sync.routes,
    ...conflict.routes,
    {
      method: 'GET',
      path: '/sync/ships',
      handler: 'sync.listShips',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/sync/ships/:shipId',
      handler: 'sync.getShipStatus',
      config: {
        policies: [],
      },
    },
  ],
};
