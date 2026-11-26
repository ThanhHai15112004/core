import { env } from './env.js';

export type DrTopologyMode = 'BACKUP_RESTORE' | 'PILOT_LIGHT' | 'WARM_STANDBY' | 'HOT_STANDBY';

const ALLOWED_TOPOLOGY_MODES: readonly DrTopologyMode[] = [
  'BACKUP_RESTORE',
  'PILOT_LIGHT',
  'WARM_STANDBY',
  'HOT_STANDBY',
];

const DEFAULT_RECONCILE_TABLES = ['users', 'roles', 'permissions', 'files', 'backup_records'];

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};

const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

const listOr = (key: string, fallback: string[]): string[] => {
  const raw = env(key, false);
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

function resolveTopologyMode(raw: string): DrTopologyMode {
  const normalized = raw.trim().toUpperCase() as DrTopologyMode;
  return ALLOWED_TOPOLOGY_MODES.includes(normalized) ? normalized : 'WARM_STANDBY';
}

/** Cấu hình Disaster Recovery (Mục 13.7 — Opt-in theo dự án). */
export const drConfig = () => {
  const rpoTargetSeconds = Math.min(
    604_800,
    Math.max(1, numberOr('DR_RPO_TARGET_SECONDS', 900)),
  );
  const rtoTargetSeconds = Math.min(
    604_800,
    Math.max(1, numberOr('DR_RTO_TARGET_SECONDS', 1800)),
  );
  const drillIntervalDays = Math.min(365, Math.max(1, numberOr('DR_DRILL_INTERVAL_DAYS', 30)));
  const rawDriver = (env('DR_STORAGE_DRIVER', false) || 'local').trim().toLowerCase();

  return {
    enabled: booleanOr('DR_ENABLED', false),
    topologyMode: resolveTopologyMode(env('DR_TOPOLOGY_MODE', false) || 'WARM_STANDBY'),
    rpoTargetSeconds,
    rtoTargetSeconds,
    primarySite: {
      code: (env('DR_PRIMARY_SITE_CODE', false) || 'dc-primary').trim(),
      name: (env('DR_PRIMARY_SITE_NAME', false) || 'Primary Data Center').trim(),
      region: (env('DR_PRIMARY_REGION', false) || 'ap-southeast-1').trim(),
      endpoint: (env('DR_PRIMARY_ENDPOINT', false) || '').trim(),
    },
    drSite: {
      code: (env('DR_SECONDARY_SITE_CODE', false) || 'dc-dr').trim(),
      name: (env('DR_SECONDARY_SITE_NAME', false) || 'DR Standby Site').trim(),
      region: (env('DR_SECONDARY_REGION', false) || 'ap-southeast-2').trim(),
      endpoint: (env('DR_SECONDARY_ENDPOINT', false) || '').trim(),
    },
    db: {
      host: (env('DR_DB_HOST', false) || '').trim(),
      port: Math.max(0, numberOr('DR_DB_PORT', 0)),
      database: (env('DR_DB_DATABASE', false) || '').trim(),
      username: (env('DR_DB_USERNAME', false) || '').trim(),
      password: env('DR_DB_PASSWORD', false) || '',
    },
    storage: {
      driver: rawDriver === 's3' ? ('s3' as const) : ('local' as const),
      localPath: (env('DR_STORAGE_LOCAL_PATH', false) || './uploads-dr').trim(),
      prefix: (env('DR_STORAGE_PREFIX', false) || 'dr-replica').replace(/^\/+|\/+$/g, ''),
      s3Endpoint: (env('DR_STORAGE_S3_ENDPOINT', false) || '').trim(),
      s3Region: (env('DR_STORAGE_S3_REGION', false) || '').trim(),
      s3Bucket: (env('DR_STORAGE_S3_BUCKET', false) || '').trim(),
      s3AccessKeySecret: env('DR_STORAGE_S3_ACCESS_KEY', false) || '',
      s3SecretKey: env('DR_STORAGE_S3_SECRET_KEY', false) || '',
    },
    syncCron: (env('DR_SYNC_CRON', false) || '*/15 * * * *').trim(),
    drillCron: (env('DR_DRILL_CRON', false) || '0 5 1 * *').trim(),
    drillIntervalDays,
    autoExecuteScheduledDrill: booleanOr('DR_AUTO_EXECUTE_DRILL', false),
    liveSwitchEnabled: booleanOr('DR_LIVE_SWITCH_ENABLED', false),
    switchWebhookUrl: (env('DR_SWITCH_WEBHOOK_URL', false) || '').trim(),
    switchWebhookSecret: env('DR_SWITCH_WEBHOOK_SECRET', false) || '',
    reconcileTables: listOr('DR_RECONCILE_TABLES', DEFAULT_RECONCILE_TABLES),
  };
};

export type DrConfig = ReturnType<typeof drConfig>;
