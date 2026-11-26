import type { Tone } from '@core/theme';

export const BACKUPS_TABS = ['overview', 'records', 'restores', 'runbook'] as const;
export type BackupsTab = (typeof BACKUPS_TABS)[number];

export const BACKUP_STATUS_TONE: Record<string, Tone> = {
  healthy: 'ok',
  warning: 'warn',
  critical: 'crit',
  unknown: 'unknown',
  SUCCESS: 'ok',
  RUNNING: 'info',
  FAILED: 'crit',
  EXPIRED: 'warn',
  PURGED: 'unknown',
  PASSED: 'ok',
  PENDING: 'unknown',
  SKIPPED: 'unknown',
  enabled: 'ok',
  suspended: 'warn',
  disabled: 'crit',
  unsupported: 'unknown',
};
