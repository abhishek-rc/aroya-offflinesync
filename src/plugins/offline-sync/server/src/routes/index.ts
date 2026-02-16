import syncRoutes from './sync';
import conflictRoutes from './conflict';
import healthRoutes from './health';
import initialSyncRoutes from './initial-sync';
import mediaRoutes from './media';

export default {
  'content-api': {
    type: 'content-api',
    routes: [
      ...syncRoutes,
      ...conflictRoutes,
      ...initialSyncRoutes,
      ...mediaRoutes,
    ],
  },
  health: healthRoutes,
};

