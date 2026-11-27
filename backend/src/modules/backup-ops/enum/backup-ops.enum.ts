export const BACKUP_TARGET_TYPE = {
  DATABASE: 'DATABASE',
  STORAGE: 'STORAGE',
} as const;
export type BackupTargetType = (typeof BACKUP_TARGET_TYPE)[keyof typeof BACKUP_TARGET_TYPE];

export const BACKUP_TRIGGER_SOURCE = {
  SCHEDULED: 'SCHEDULED',
  MANUAL: 'MANUAL',
  CLI: 'CLI',
} as const;
export type BackupTriggerSource =
  (typeof BACKUP_TRIGGER_SOURCE)[keyof typeof BACKUP_TRIGGER_SOURCE];

export const BACKUP_RECORD_STATUS = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  PURGED: 'PURGED',
} as const;
export type BackupRecordStatus = (typeof BACKUP_RECORD_STATUS)[keyof typeof BACKUP_RECORD_STATUS];

export const BACKUP_VERIFY_STATUS = {
  PENDING: 'PENDING',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type BackupVerifyStatus = (typeof BACKUP_VERIFY_STATUS)[keyof typeof BACKUP_VERIFY_STATUS];

export const RESTORE_OPERATION_TYPE = {
  DRILL_ISOLATED: 'DRILL_ISOLATED',
  MANUAL_RESTORE: 'MANUAL_RESTORE',
  LIVE_RESTORE: 'LIVE_RESTORE',
} as const;
export type RestoreOperationType =
  (typeof RESTORE_OPERATION_TYPE)[keyof typeof RESTORE_OPERATION_TYPE];

export const RESTORE_SCOPE = {
  DATABASE: 'DATABASE',
  STORAGE: 'STORAGE',
  SECRETS_CONFIG: 'SECRETS_CONFIG',
  FULL: 'FULL',
} as const;
export type RestoreScope = (typeof RESTORE_SCOPE)[keyof typeof RESTORE_SCOPE];

export const RESTORE_STATUS = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type RestoreStatus = (typeof RESTORE_STATUS)[keyof typeof RESTORE_STATUS];

export const BACKUP_AUDIT_ACTIONS = {
  POLICY_CREATED: 'backup.policy.created',
  POLICY_UPDATED: 'backup.policy.updated',
  BACKUP_EXECUTED: 'backup.executed',
  BACKUP_PRUNED: 'backup.pruned',
  DRILL_EXECUTED: 'backup.drill.executed',
  RESTORE_RECORDED: 'backup.restore.recorded',
  RESTORE_EXECUTED: 'backup.restore.executed',
  STORAGE_VERSIONING_ENABLED: 'backup.storage_versioning.enabled',
} as const;
