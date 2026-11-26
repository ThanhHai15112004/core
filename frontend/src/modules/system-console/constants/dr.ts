import type { Tone } from '@core/theme';
import type { DrTopologyMode } from '../types/dr.types';

export const DR_TABS = ['overview', 'sync-reconcile', 'switchover', 'drills'] as const;
export type DrTab = (typeof DR_TABS)[number];

export const DR_TOPOLOGY_OPTIONS: readonly DrTopologyMode[] = [
  'BACKUP_RESTORE',
  'PILOT_LIGHT',
  'WARM_STANDBY',
  'HOT_STANDBY',
];

export const DR_LIST_LIMIT = 20;

export const DR_STATUS_TONE: Record<string, Tone> = {
  disabled: 'unknown',
  healthy: 'ok',
  warning: 'warn',
  critical: 'crit',
  unknown: 'unknown',
  MET: 'ok',
  BREACHED: 'crit',
  UNKNOWN: 'unknown',
  SUCCESS: 'ok',
  PASSED: 'ok',
  COMPLETED: 'ok',
  IN_PROGRESS: 'info',
  RUNNING: 'info',
  DEGRADED: 'warn',
  DISCREPANCIES_FOUND: 'warn',
  ABORTED: 'warn',
  SKIPPED: 'unknown',
  PENDING: 'unknown',
  FAILED: 'crit',
  PRIMARY: 'ok',
  DR: 'warn',
};
