export const HEALTH_STATUS = {
  OK: 'ok',
  DEGRADED: 'degraded',
  DOWN: 'down',
} as const;

export type HealthStatusValue = (typeof HEALTH_STATUS)[keyof typeof HEALTH_STATUS];

export const HEALTH_INDICATOR_STATUS = {
  UP: 'up',
  DEGRADED: 'degraded',
  DOWN: 'down',
} as const;

export type HealthIndicatorStatusValue =
  (typeof HEALTH_INDICATOR_STATUS)[keyof typeof HEALTH_INDICATOR_STATUS];

export const HEALTH_SEVERITY = {
  OK: 'ok',
  DEGRADED: 'degraded',
  CRITICAL: 'critical',
} as const;

export type HealthSeverityValue = (typeof HEALTH_SEVERITY)[keyof typeof HEALTH_SEVERITY];

export const HEALTH_SETTING_KEYS = {
  DB_TIMEOUT_MS: 'health.db.timeout_ms',
  REDIS_TIMEOUT_MS: 'health.redis.timeout_ms',
  REDIS_DEGRADED_LATENCY_MS: 'health.redis.degraded_latency_ms',
  QUEUE_BACKLOG_WARN_THRESHOLD: 'health.queue.backlog_warn_threshold',
  QUEUE_FAILED_WARN_THRESHOLD: 'health.queue.failed_warn_threshold',
  QUEUE_REQUIRE_ACTIVE_WORKERS: 'health.queue.require_active_workers',
  STORAGE_TIMEOUT_MS: 'health.storage.timeout_ms',
  STORAGE_WRITE_PROBE_ENABLED: 'health.storage.write_probe_enabled',
  PROVIDERS_ACTIVE_PROBE_ENABLED: 'health.providers.active_probe_enabled',
  PROVIDERS_TIMEOUT_MS: 'health.providers.timeout_ms',
  MIGRATION_CHECK_ENABLED: 'health.migration.check_enabled',
  MIGRATION_CACHE_TTL_SEC: 'health.migration.cache_ttl_sec',
  READINESS_FAIL_ON_PENDING_MIGRATION: 'health.readiness.fail_on_pending_migration',
  LIVENESS_EVENT_LOOP_LAG_WARN_MS: 'health.liveness.event_loop_lag_warn_ms',
  LIVENESS_HEAP_LIMIT_RATIO: 'health.liveness.heap_limit_ratio',
  PUBLIC_HIDE_DETAILS: 'health.public.hide_details',
} as const;

export const HEALTH_DEFAULTS = {
  DB_TIMEOUT_MS: 2000,
  REDIS_TIMEOUT_MS: 2000,
  REDIS_DEGRADED_LATENCY_MS: 200,
  QUEUE_BACKLOG_WARN_THRESHOLD: 1000,
  QUEUE_FAILED_WARN_THRESHOLD: 100,
  QUEUE_REQUIRE_ACTIVE_WORKERS: false,
  STORAGE_TIMEOUT_MS: 3000,
  STORAGE_WRITE_PROBE_ENABLED: false,
  PROVIDERS_ACTIVE_PROBE_ENABLED: false,
  PROVIDERS_TIMEOUT_MS: 3000,
  MIGRATION_CHECK_ENABLED: true,
  MIGRATION_CACHE_TTL_SEC: 15,
  READINESS_FAIL_ON_PENDING_MIGRATION: false,
  LIVENESS_EVENT_LOOP_LAG_WARN_MS: 250,
  LIVENESS_HEAP_LIMIT_RATIO: 0.9,
  PUBLIC_HIDE_DETAILS: true,
} as const;

export const HEALTH_ADMIN_PERMISSIONS = [
  'health.read',
  'health.manage',
  'system.ops.read',
  'system.ops.manage',
  'settings.read',
  'system.admin',
  '*',
] as const;

export const HEALTH_ADMIN_ROLES = ['super_admin', 'admin', 'admin_ops', 'admin_security'] as const;
