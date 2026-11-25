import {
  SettingRegistryService,
  defaultSettingRegistry,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import {
  OUTBOX_DEFAULTS,
  OUTBOX_DEFAULT_ALERT_CHANNELS,
  OUTBOX_DEFAULT_ALERT_COOLDOWN_SEC,
  OUTBOX_DEFAULT_ALERT_ROLES,
  OUTBOX_SETTING_KEYS,
} from '../enum/outbox.enum.js';
import type { OutboxRuntimeConfig } from '../types/outbox.types.js';

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

function readStringArray(
  registry: SettingRegistryService,
  key: string,
  fallback: readonly string[],
): string[] {
  const raw = registry.getJson<unknown>(key, undefined, fallback);
  if (Array.isArray(raw)) {
    const items = raw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
    return items.length > 0 ? items : [...fallback];
  }
  if (typeof raw === 'string') {
    const parsed = safeJsonParseStringArray(raw);
    if (parsed.length > 0) return parsed;
  }
  return [...fallback];
}

/** Đọc toàn bộ cấu hình vận hành Outbox từ `SettingRegistryService` kèm giới hạn bảo vệ. */
export function resolveOutboxRuntimeConfig(
  registry: SettingRegistryService = defaultSettingRegistry,
): OutboxRuntimeConfig {
  const lagWarnCount = readClampedInt(
    registry,
    OUTBOX_SETTING_KEYS.LAG_WARN_COUNT,
    OUTBOX_DEFAULTS.LAG_WARN_COUNT,
    1,
    100_000,
  );
  const lagCritCount = Math.max(
    lagWarnCount,
    readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.LAG_CRIT_COUNT,
      OUTBOX_DEFAULTS.LAG_CRIT_COUNT,
      1,
      500_000,
    ),
  );
  const lagWarnAgeSec = readClampedInt(
    registry,
    OUTBOX_SETTING_KEYS.LAG_WARN_AGE_SEC,
    OUTBOX_DEFAULTS.LAG_WARN_AGE_SEC,
    5,
    86_400,
  );
  const lagCritAgeSec = Math.max(
    lagWarnAgeSec,
    readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.LAG_CRIT_AGE_SEC,
      OUTBOX_DEFAULTS.LAG_CRIT_AGE_SEC,
      5,
      86_400,
    ),
  );
  const retryBaseDelayMs = readClampedInt(
    registry,
    OUTBOX_SETTING_KEYS.RETRY_BASE_DELAY_MS,
    OUTBOX_DEFAULTS.RETRY_BASE_DELAY_MS,
    500,
    300_000,
  );
  const retryMaxDelayMs = Math.max(
    retryBaseDelayMs,
    readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.RETRY_MAX_DELAY_MS,
      OUTBOX_DEFAULTS.RETRY_MAX_DELAY_MS,
      1_000,
      3_600_000,
    ),
  );

  return {
    maxRetries: readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.MAX_RETRIES,
      OUTBOX_DEFAULTS.MAX_RETRIES,
      1,
      OUTBOX_DEFAULTS.MAX_RETRIES_CAP,
    ),
    retryBaseDelayMs,
    retryMaxDelayMs,
    pollIntervalMs: readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.POLL_INTERVAL_MS,
      OUTBOX_DEFAULTS.POLL_INTERVAL_MS,
      250,
      60_000,
    ),
    batchSize: readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.BATCH_SIZE,
      OUTBOX_DEFAULTS.BATCH_SIZE,
      1,
      500,
    ),
    leaseTimeoutMs: readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.LEASE_TIMEOUT_MS,
      OUTBOX_DEFAULTS.LEASE_TIMEOUT_MS,
      5_000,
      600_000,
    ),
    lagWarnCount,
    lagCritCount,
    lagWarnAgeSec,
    lagCritAgeSec,
    deadLetterWarnCount: readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.DEAD_LETTER_WARN_COUNT,
      OUTBOX_DEFAULTS.DEAD_LETTER_WARN_COUNT,
      1,
      10_000,
    ),
    retentionPublishedDays: readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.RETENTION_PUBLISHED_DAYS,
      OUTBOX_DEFAULTS.RETENTION_PUBLISHED_DAYS,
      1,
      365,
    ),
    retentionDeadLetterDays: readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.RETENTION_DEAD_LETTER_DAYS,
      OUTBOX_DEFAULTS.RETENTION_DEAD_LETTER_DAYS,
      1,
      365,
    ),
    cleanupBatchSize: readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.CLEANUP_BATCH_SIZE,
      OUTBOX_DEFAULTS.CLEANUP_BATCH_SIZE,
      50,
      10_000,
    ),
    alertAdminRoles: readStringArray(
      registry,
      OUTBOX_SETTING_KEYS.ALERT_ADMIN_ROLES,
      OUTBOX_DEFAULT_ALERT_ROLES,
    ),
    alertChannels: readStringArray(
      registry,
      OUTBOX_SETTING_KEYS.ALERT_CHANNELS,
      OUTBOX_DEFAULT_ALERT_CHANNELS,
    ),
    alertCooldownSec: readClampedInt(
      registry,
      OUTBOX_SETTING_KEYS.ALERT_COOLDOWN_SEC,
      OUTBOX_DEFAULT_ALERT_COOLDOWN_SEC,
      60,
      86_400,
    ),
  };
}

/**
 * Tính thời gian chờ retry theo Exponential Backoff + Jitter (±20%):
 * - attempt 1 -> baseDelay
 * - attempt 2 -> baseDelay * 2
 * - attempt n -> min(maxDelay, baseDelay * 2^(n-1)) * jitter
 */
export function computeOutboxRetryDelayMs(
  attemptCount: number,
  config: Pick<OutboxRuntimeConfig, 'retryBaseDelayMs' | 'retryMaxDelayMs'>,
  randomFn: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.min(20, attemptCount - 1));
  const exponential = Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * 2 ** exponent);
  const jitterFactor = 0.8 + Math.max(0, Math.min(1, randomFn())) * 0.4;
  return Math.max(config.retryBaseDelayMs, Math.min(config.retryMaxDelayMs, Math.round(exponential * jitterFactor)));
}

/**
 * Phân loại lỗi gửi Outbox: lỗi cấu trúc/không hợp lệ (`PERMANENT`) sẽ đưa thẳng vào Dead Letter,
 * còn lỗi kết nối/broker/timeout sẽ được retry có giới hạn.
 */
export function classifyOutboxDispatchError(err: unknown): {
  readonly code: string;
  readonly message: string;
  readonly permanent: boolean;
} {
  if (err && typeof err === 'object') {
    const record = err as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      permanent?: unknown;
      nonRetryable?: unknown;
    };
    const rawCode =
      typeof record.code === 'string' && record.code.trim()
        ? record.code.trim().toUpperCase().slice(0, 80)
        : typeof record.name === 'string' && record.name.trim()
          ? record.name.trim().toUpperCase().slice(0, 80)
          : 'OUTBOX_DISPATCH_ERROR';
    const message =
      typeof record.message === 'string' && record.message.trim()
        ? record.message.trim().slice(0, 1000)
        : String(err).slice(0, 1000);
    const permanent =
      record.permanent === true ||
      record.nonRetryable === true ||
      rawCode === 'INVALID_OUTBOX_PAYLOAD' ||
      rawCode === 'UNKNOWN_DESTINATION_QUEUE' ||
      rawCode === 'SERIALIZATION_ERROR';
    return { code: rawCode, message, permanent };
  }

  return {
    code: 'OUTBOX_DISPATCH_ERROR',
    message: String(err ?? 'Unknown outbox dispatch error').slice(0, 1000),
    permanent: false,
  };
}
