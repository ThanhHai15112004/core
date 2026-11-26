export const BACKUP_QUEUE_TOPICS = {
  SCHEDULE_TICK: 'backup.schedule.tick',
  RETENTION_PRUNE_TICK: 'backup.retention.prune.tick',
  VERIFY_DRILL_TICK: 'backup.verify.drill.tick',
  RUN_JOB: 'backup.run.job',
} as const;

export type BackupQueueTopic = (typeof BACKUP_QUEUE_TOPICS)[keyof typeof BACKUP_QUEUE_TOPICS];

export const BACKUP_DOMAIN_EVENTS = {
  COMPLETED: 'backup.completed',
  FAILED: 'backup.failed',
  STALE: 'backup.stale',
  PRUNED: 'backup.pruned',
  DRILL_PASSED: 'backup.drill.passed',
  DRILL_FAILED: 'backup.drill.failed',
  RESTORE_RECORDED: 'backup.restore.recorded',
  STORAGE_VERSIONING_UPDATED: 'backup.storage_versioning.updated',
} as const;

export type BackupDomainEventName =
  (typeof BACKUP_DOMAIN_EVENTS)[keyof typeof BACKUP_DOMAIN_EVENTS];
