import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};

const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

/** Cấu hình Backup & Restore hạ tầng (Mục 13.6). */
export const backupConfig = () => {
  const defaultRetentionDays = Math.min(3650, Math.max(1, numberOr('BACKUP_RETENTION_DAYS', 14)));
  const defaultMaxKeepCount = Math.min(1000, Math.max(1, numberOr('BACKUP_MAX_KEEP_COUNT', 30)));
  const staleMaxAgeHours = Math.max(1, numberOr('BACKUP_STALE_MAX_AGE_HOURS', 26));
  const commandTimeoutMs = Math.max(5_000, numberOr('BACKUP_COMMAND_TIMEOUT_MS', 300_000));
  const maxStorageSnapshotBytes = Math.max(
    1024 * 1024,
    numberOr('BACKUP_MAX_STORAGE_SNAPSHOT_BYTES', 256 * 1024 * 1024),
  );

  return {
    enabled: booleanOr('BACKUP_ENABLED', true),
    storagePrefix: (env('BACKUP_STORAGE_PREFIX', false) || 'backups').replace(/^\/+|\/+$/g, ''),
    encryptionEnabled: booleanOr('BACKUP_ENCRYPTION_ENABLED', true),
    encryptionKey: env('BACKUP_ENCRYPTION_KEY', false) || '',
    defaultRetentionDays,
    defaultMaxKeepCount,
    staleMaxAgeHours,
    dbBackupCron: env('BACKUP_DB_CRON', false) || '0 2 * * *',
    storageBackupCron: env('BACKUP_STORAGE_CRON', false) || '30 2 * * 0',
    retentionPruneCron: env('BACKUP_RETENTION_PRUNE_CRON', false) || '0 3 * * *',
    drillEnabled: booleanOr('BACKUP_DRILL_ENABLED', true),
    drillCron: env('BACKUP_DRILL_CRON', false) || '0 4 * * *',
    drillDatabase: env('BACKUP_DRILL_DATABASE', false) || '',
    drillHost: env('BACKUP_DRILL_HOST', false) || '',
    drillPort: Math.max(0, numberOr('BACKUP_DRILL_PORT', 0)),
    drillUsername: env('BACKUP_DRILL_USERNAME', false) || '',
    drillPassword: env('BACKUP_DRILL_PASSWORD', false) || '',
    commandTimeoutMs,
    maxStorageSnapshotBytes,
    restoreExecutionEnabled: booleanOr('BACKUP_RESTORE_EXECUTION_ENABLED', false),
  };
};

export type BackupConfig = ReturnType<typeof backupConfig>;

/** Tạo env cho tiến trình con backup (mysqldump/pg_dump/mysql/psql) mà không đọc trực tiếp process.env ở tầng module. */
export function buildBackupProcessEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides };
}
