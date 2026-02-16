import syncQueue from './sync-queue';
import versionManager from './version-manager';
import kafkaProducer from './kafka-producer';
import kafkaConsumer from './kafka-consumer';
import syncService from './sync-service';
import conflictResolver from './conflict-resolver';
import shipTracker from './ship-tracker';
import connectivityMonitor from './connectivity-monitor';
import messageTracker from './message-tracker';
import deadLetter from './dead-letter';
import documentMapping from './document-mapping';
import initialSync from './initial-sync';
import masterSyncQueue from './master-sync-queue';
import mediaSync from './media-sync';

export default {
  'sync-queue': syncQueue,
  'version-manager': versionManager,
  'kafka-producer': kafkaProducer,
  'kafka-consumer': kafkaConsumer,
  'sync-service': syncService,
  'conflict-resolver': conflictResolver,
  'ship-tracker': shipTracker,
  'connectivity-monitor': connectivityMonitor,
  'message-tracker': messageTracker,
  'dead-letter': deadLetter,
  'document-mapping': documentMapping,
  'initial-sync': initialSync,
  'master-sync-queue': masterSyncQueue,
  'media-sync': mediaSync,
};

