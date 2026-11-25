import { SettingRegistryService, defaultSettingRegistry } from '@packages/kernel/index.js';
import { HEALTH_DEFAULTS, HEALTH_SETTING_KEYS } from '../enum/health.enum.js';
import type { HealthRuntimeConfig } from '../types/health.types.js';

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.trunc(val)));
}

function clampFloat(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

/** Đọc toàn bộ cấu hình Health Check động từ `SettingRegistryService` kèm giới hạn an toàn. */
export function resolveHealthConfig(
  settingRegistry: SettingRegistryService = defaultSettingRegistry,
): HealthRuntimeConfig {
  return {
    dbTimeoutMs: clampInt(
      settingRegistry.getNumber(
        HEALTH_SETTING_KEYS.DB_TIMEOUT_MS,
        undefined,
        HEALTH_DEFAULTS.DB_TIMEOUT_MS,
      ),
      200,
      30_000,
    ),
    redisTimeoutMs: clampInt(
      settingRegistry.getNumber(
        HEALTH_SETTING_KEYS.REDIS_TIMEOUT_MS,
        undefined,
        HEALTH_DEFAULTS.REDIS_TIMEOUT_MS,
      ),
      200,
      30_000,
    ),
    redisDegradedLatencyMs: clampInt(
      settingRegistry.getNumber(
        HEALTH_SETTING_KEYS.REDIS_DEGRADED_LATENCY_MS,
        undefined,
        HEALTH_DEFAULTS.REDIS_DEGRADED_LATENCY_MS,
      ),
      10,
      10_000,
    ),
    queueBacklogWarnThreshold: clampInt(
      settingRegistry.getNumber(
        HEALTH_SETTING_KEYS.QUEUE_BACKLOG_WARN_THRESHOLD,
        undefined,
        HEALTH_DEFAULTS.QUEUE_BACKLOG_WARN_THRESHOLD,
      ),
      1,
      1_000_000,
    ),
    queueFailedWarnThreshold: clampInt(
      settingRegistry.getNumber(
        HEALTH_SETTING_KEYS.QUEUE_FAILED_WARN_THRESHOLD,
        undefined,
        HEALTH_DEFAULTS.QUEUE_FAILED_WARN_THRESHOLD,
      ),
      1,
      1_000_000,
    ),
    queueRequireActiveWorkers: settingRegistry.getBoolean(
      HEALTH_SETTING_KEYS.QUEUE_REQUIRE_ACTIVE_WORKERS,
      undefined,
      HEALTH_DEFAULTS.QUEUE_REQUIRE_ACTIVE_WORKERS,
    ),
    storageTimeoutMs: clampInt(
      settingRegistry.getNumber(
        HEALTH_SETTING_KEYS.STORAGE_TIMEOUT_MS,
        undefined,
        HEALTH_DEFAULTS.STORAGE_TIMEOUT_MS,
      ),
      200,
      30_000,
    ),
    storageWriteProbeEnabled: settingRegistry.getBoolean(
      HEALTH_SETTING_KEYS.STORAGE_WRITE_PROBE_ENABLED,
      undefined,
      HEALTH_DEFAULTS.STORAGE_WRITE_PROBE_ENABLED,
    ),
    providersActiveProbeEnabled: settingRegistry.getBoolean(
      HEALTH_SETTING_KEYS.PROVIDERS_ACTIVE_PROBE_ENABLED,
      undefined,
      HEALTH_DEFAULTS.PROVIDERS_ACTIVE_PROBE_ENABLED,
    ),
    providersTimeoutMs: clampInt(
      settingRegistry.getNumber(
        HEALTH_SETTING_KEYS.PROVIDERS_TIMEOUT_MS,
        undefined,
        HEALTH_DEFAULTS.PROVIDERS_TIMEOUT_MS,
      ),
      200,
      30_000,
    ),
    migrationCheckEnabled: settingRegistry.getBoolean(
      HEALTH_SETTING_KEYS.MIGRATION_CHECK_ENABLED,
      undefined,
      HEALTH_DEFAULTS.MIGRATION_CHECK_ENABLED,
    ),
    migrationCacheTtlSec: clampInt(
      settingRegistry.getNumber(
        HEALTH_SETTING_KEYS.MIGRATION_CACHE_TTL_SEC,
        undefined,
        HEALTH_DEFAULTS.MIGRATION_CACHE_TTL_SEC,
      ),
      0,
      3_600,
    ),
    failOnPendingMigration: settingRegistry.getBoolean(
      HEALTH_SETTING_KEYS.READINESS_FAIL_ON_PENDING_MIGRATION,
      undefined,
      HEALTH_DEFAULTS.READINESS_FAIL_ON_PENDING_MIGRATION,
    ),
    eventLoopLagWarnMs: clampInt(
      settingRegistry.getNumber(
        HEALTH_SETTING_KEYS.LIVENESS_EVENT_LOOP_LAG_WARN_MS,
        undefined,
        HEALTH_DEFAULTS.LIVENESS_EVENT_LOOP_LAG_WARN_MS,
      ),
      20,
      10_000,
    ),
    heapLimitRatio: clampFloat(
      settingRegistry.getNumber(
        HEALTH_SETTING_KEYS.LIVENESS_HEAP_LIMIT_RATIO,
        undefined,
        HEALTH_DEFAULTS.LIVENESS_HEAP_LIMIT_RATIO,
      ),
      0.5,
      0.99,
    ),
    hidePublicDetails: settingRegistry.getBoolean(
      HEALTH_SETTING_KEYS.PUBLIC_HIDE_DETAILS,
      undefined,
      HEALTH_DEFAULTS.PUBLIC_HIDE_DETAILS,
    ),
  };
}
