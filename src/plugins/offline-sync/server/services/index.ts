import versionTracker from './version-tracker';
import queueManager from './queue-manager';
import conflictResolver from './conflict-resolver';
import syncService from './sync-service';
import shipTracker from './ship-tracker';
import connectivityTracker from './connectivity-tracker';

export default {
  'version-tracker': versionTracker,
  'queue-manager': queueManager,
  'conflict-resolver': conflictResolver,
  'sync-service': syncService,
  'ship-tracker': shipTracker,
  'connectivity-tracker': connectivityTracker,
};

