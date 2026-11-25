import {
  SettingRegistryService,
  defaultSettingRegistry,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import {
  IDEMPOTENCY_DEFAULTS,
  IDEMPOTENCY_SCOPE,
  IDEMPOTENCY_SETTING_KEYS,
  type IdempotencyScope,
} from '../enum/idempotency.enum.js';
import type { IdempotencyRuntimeConfig } from '../types/idempotency.types.js';

function readClampedInt(
  registry: SettingRegistryService,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const num = registry.getNumber(key, undefined, fallback);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function readClampedFloat(
  registry: SettingRegistryService,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const num = registry.getNumber(key, undefined, fallback);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function readFlowTtlOverrides(registry: SettingRegistryService): Record<string, number> {
  const raw = registry.getJson<unknown>(IDEMPOTENCY_SETTING_KEYS.FLOW_TTL_OVERRIDES, undefined, {});
  const obj =
    typeof raw === 'string'
      ? safeJsonParseObject<Record<string, unknown>>(raw, {})
      : raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

  const overrides: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    const cleanKey = k.trim();
    const numeric = typeof v === 'number' ? v : Number(v);
    if (cleanKey && Number.isFinite(numeric) && numeric >= 1) {
      overrides[cleanKey] = Math.min(31_536_000, Math.round(numeric));
    }
  }
  return overrides;
}

/** Đọc toàn bộ cấu hình Idempotency từ `SettingRegistryService` kèm giới hạn an toàn. */
export function resolveIdempotencyRuntimeConfig(
  registry: SettingRegistryService = defaultSettingRegistry,
): IdempotencyRuntimeConfig {
  const duplicateRateWarnPercent = readClampedFloat(
    registry,
    IDEMPOTENCY_SETTING_KEYS.DUPLICATE_RATE_WARN_PERCENT,
    IDEMPOTENCY_DEFAULTS.DUPLICATE_RATE_WARN_PERCENT,
    1,
    95,
  );
  const duplicateRateCritPercent = Math.max(
    duplicateRateWarnPercent,
    readClampedFloat(
      registry,
      IDEMPOTENCY_SETTING_KEYS.DUPLICATE_RATE_CRIT_PERCENT,
      IDEMPOTENCY_DEFAULTS.DUPLICATE_RATE_CRIT_PERCENT,
      5,
      100,
    ),
  );
  const clientRepeatWarnHits = readClampedInt(
    registry,
    IDEMPOTENCY_SETTING_KEYS.CLIENT_REPEAT_WARN_HITS,
    IDEMPOTENCY_DEFAULTS.CLIENT_REPEAT_WARN_HITS,
    2,
    100_000,
  );
  const clientRepeatCritHits = Math.max(
    clientRepeatWarnHits,
    readClampedInt(
      registry,
      IDEMPOTENCY_SETTING_KEYS.CLIENT_REPEAT_CRIT_HITS,
      IDEMPOTENCY_DEFAULTS.CLIENT_REPEAT_CRIT_HITS,
      5,
      1_000_000,
    ),
  );

  return {
    apiTtlSec: readClampedInt(
      registry,
      IDEMPOTENCY_SETTING_KEYS.API_TTL_SEC,
      IDEMPOTENCY_DEFAULTS.API_TTL_SEC,
      60,
      7_776_000,
    ),
    jobTtlSec: readClampedInt(
      registry,
      IDEMPOTENCY_SETTING_KEYS.JOB_TTL_SEC,
      IDEMPOTENCY_DEFAULTS.JOB_TTL_SEC,
      60,
      7_776_000,
    ),
    webhookTtlSec: readClampedInt(
      registry,
      IDEMPOTENCY_SETTING_KEYS.WEBHOOK_TTL_SEC,
      IDEMPOTENCY_DEFAULTS.WEBHOOK_TTL_SEC,
      300,
      31_536_000,
    ),
    eventTtlSec: readClampedInt(
      registry,
      IDEMPOTENCY_SETTING_KEYS.EVENT_TTL_SEC,
      IDEMPOTENCY_DEFAULTS.EVENT_TTL_SEC,
      300,
      31_536_000,
    ),
    flowTtlOverrides: readFlowTtlOverrides(registry),
    lockLeaseSec: readClampedInt(
      registry,
      IDEMPOTENCY_SETTING_KEYS.LOCK_LEASE_SEC,
      IDEMPOTENCY_DEFAULTS.LOCK_LEASE_SEC,
      5,
      3600,
    ),
    maxResponseBytes: readClampedInt(
      registry,
      IDEMPOTENCY_SETTING_KEYS.MAX_RESPONSE_BYTES,
      IDEMPOTENCY_DEFAULTS.MAX_RESPONSE_BYTES,
      1024,
      2_097_152,
    ),
    cleanupBatchSize: readClampedInt(
      registry,
      IDEMPOTENCY_SETTING_KEYS.CLEANUP_BATCH_SIZE,
      IDEMPOTENCY_DEFAULTS.CLEANUP_BATCH_SIZE,
      50,
      10_000,
    ),
    duplicateRateWarnPercent,
    duplicateRateCritPercent,
    clientRepeatWarnHits,
    clientRepeatCritHits,
  };
}

/**
 * Phân giải thời gian lưu khóa chống trùng (TTL giây) theo thứ tự ưu tiên:
 * 1. Override cấu hình động theo luồng cụ thể (`"<SCOPE>:<scopeTarget>"` hoặc `"<scopeTarget>"`) trong Settings.
 * 2. Tham số `codeTtlSec` khai báo trực tiếp tại `@Idempotent` / `PublishOptions` / handler.
 * 3. TTL mặc định theo loại luồng (`API` / `JOB` / `WEBHOOK` / `EVENT`) trong Settings.
 */
export function resolveEffectiveIdempotencyTtlSec(
  config: IdempotencyRuntimeConfig,
  scope: IdempotencyScope,
  scopeTarget: string,
  codeTtlSec?: number | null,
): number {
  const compositeKey = `${scope}:${scopeTarget}`;
  const fromComposite = config.flowTtlOverrides[compositeKey];
  if (typeof fromComposite === 'number' && Number.isFinite(fromComposite) && fromComposite >= 1) {
    return fromComposite;
  }

  const fromTarget = config.flowTtlOverrides[scopeTarget];
  if (typeof fromTarget === 'number' && Number.isFinite(fromTarget) && fromTarget >= 1) {
    return fromTarget;
  }

  if (typeof codeTtlSec === 'number' && Number.isFinite(codeTtlSec) && codeTtlSec >= 1) {
    return Math.min(31_536_000, Math.round(codeTtlSec));
  }

  switch (scope) {
    case IDEMPOTENCY_SCOPE.JOB:
      return config.jobTtlSec;
    case IDEMPOTENCY_SCOPE.WEBHOOK:
      return config.webhookTtlSec;
    case IDEMPOTENCY_SCOPE.EVENT:
      return config.eventTtlSec;
    case IDEMPOTENCY_SCOPE.API:
    default:
      return config.apiTtlSec;
  }
}
