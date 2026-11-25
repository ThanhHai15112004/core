import { AppException, ERROR_CATEGORY } from '../errors/app.exception.js';
import { HTTP_STATUS_CODE } from '../errors/http-exceptions.js';
import {
  SettingRegistryService,
  defaultSettingRegistry,
} from '../registries/setting-registry.service.js';
import type { SettingResolveContext } from '../contracts/setting-lookup.contract.js';

/**
 * Danh sách khóa cấu hình động (System Settings) điều khiển chính sách Resilience (Mục 11.4).
 * Các khóa này có thể chỉnh trực tiếp trên màn hình Settings mà không cần khởi động lại tiến trình.
 */
export const RESILIENCE_SETTING_KEYS = {
  // API Timeout
  API_REQUEST_TIMEOUT_MS: 'resilience.api.request_timeout_ms',

  // Database Transient Retry
  DB_RETRY_MAX: 'resilience.db.retry_max',
  DB_RETRY_BASE_DELAY_MS: 'resilience.db.retry_base_delay_ms',
  DB_RETRY_MAX_DELAY_MS: 'resilience.db.retry_max_delay_ms',
  DB_RETRY_JITTER: 'resilience.db.retry_jitter',

  // Queue / Worker Backoff Jitter & Storm
  QUEUE_RETRY_BACKOFF_JITTER: 'queue.retry.backoff_jitter',
  QUEUE_RETRY_STORM_PER_MIN: 'queue.retry.storm_per_min',

  // Outbound HTTP / Provider Timeout & Retry
  HTTP_TIMEOUT_MS: 'resilience.http.timeout_ms',
  HTTP_RETRY_MAX: 'resilience.http.retry_max',
  HTTP_RETRY_MAX_CAP: 'resilience.http.retry_max_cap',
  HTTP_RETRY_BASE_DELAY_MS: 'resilience.http.retry_base_delay_ms',
  HTTP_RETRY_MAX_DELAY_MS: 'resilience.http.retry_max_delay_ms',
  HTTP_RETRY_JITTER: 'resilience.http.retry_jitter',

  // Circuit Breaker
  HTTP_CB_ENABLED: 'resilience.http.cb_enabled',
  HTTP_CB_FAILURE_THRESHOLD: 'resilience.http.cb_failure_threshold',
  HTTP_CB_FAILURE_WINDOW_MS: 'resilience.http.cb_failure_window_ms',
  HTTP_CB_RESET_TIMEOUT_MS: 'resilience.http.cb_reset_timeout_ms',
  HTTP_CB_HALF_OPEN_PROBES: 'resilience.http.cb_half_open_probes',
  HTTP_CB_HALF_OPEN_SUCCESS_THRESHOLD: 'resilience.http.cb_half_open_success_threshold',

  // Bulkhead / Provider Concurrency Limit
  HTTP_CONCURRENCY_ENABLED: 'resilience.http.concurrency_enabled',
  HTTP_MAX_CONCURRENT: 'resilience.http.max_concurrent',
  HTTP_MAX_QUEUE: 'resilience.http.max_queue',
  HTTP_QUEUE_TIMEOUT_MS: 'resilience.http.queue_timeout_ms',

  // Retry Storm Detection & Budget Shedding
  HTTP_RETRY_STORM_PER_MIN: 'resilience.http.retry_storm_per_min',
  HTTP_RETRY_STORM_RATIO_PERCENT: 'resilience.http.retry_storm_ratio_percent',
  HTTP_RETRY_STORM_MIN_REQUESTS: 'resilience.http.retry_storm_min_requests',
  HTTP_RETRY_STORM_SHEDDING: 'resilience.http.retry_storm_shedding',
} as const;

export type BackoffStrategy = 'exponential' | 'fixed';

export interface BackoffOptions {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter?: boolean | undefined;
  readonly strategy?: BackoffStrategy | undefined;
  readonly respectRetryAfter?: boolean | undefined;
  readonly retryAfterMs?: number | null | undefined;
}

/** Danh sách HTTP status tạm thời có thể retry mặc định trên toàn hệ thống. */
export const TRANSIENT_HTTP_STATUS_CODES = [408, 429, 502, 503, 504] as const;

/** Giới hạn số lần retry trong khoảng an toàn `[0, maxCap]` để chống retry vô hạn. */
export function clampRetryCount(requested: number, maxCap: number): number {
  const safeCap = Math.max(0, Math.floor(Number.isFinite(maxCap) ? maxCap : 0));
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(safeCap, Math.floor(requested));
}

/**
 * Tính thời gian chờ giữa các lần retry theo chiến lược `exponential` hoặc `fixed` kèm Equal Jitter `[50%..100%]`.
 * Tôn trọng header `Retry-After` (nếu bật và có giá trị) nhưng luôn chặn trần tại `maxDelayMs`.
 */
export function computeResilienceBackoffMs(
  attempt: number,
  options: BackoffOptions,
  randomFn: () => number = Math.random,
): number {
  const maxDelay = Math.max(0, Math.round(options.maxDelayMs));
  if (
    options.respectRetryAfter !== false &&
    options.retryAfterMs !== null &&
    options.retryAfterMs !== undefined &&
    Number.isFinite(options.retryAfterMs)
  ) {
    return Math.min(maxDelay, Math.max(0, Math.round(options.retryAfterMs)));
  }

  const baseDelay = Math.max(0, options.baseDelayMs);
  const strategy = options.strategy ?? 'exponential';
  const raw =
    strategy === 'fixed'
      ? baseDelay
      : baseDelay * Math.pow(2, Math.max(0, Math.floor(attempt) - 1));
  const cap = Math.min(maxDelay, raw);

  if (!options.jitter) {
    return Math.round(cap);
  }
  const r = Math.min(1, Math.max(0, randomFn()));
  return Math.round(cap * (0.5 + 0.5 * r));
}

/** Tạm dừng có hỗ trợ hủy sớm qua `AbortSignal`. */
export function sleepWithAbortSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return signal?.aborted ? Promise.reject(signal.reason) : Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    timer.unref?.();

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted during retry backoff'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Kiểm tra lỗi có phải là lỗi tạm thời (transient) được phép retry hay không.
 * - Trả về `true` cho lỗi tạm thời rõ ràng (408, 429, 502, 503, 504, timeout, network).
 * - Trả về `false` cho lỗi nghiệp vụ / client 4xx (`AppException` 4xx, `ZodError`, lỗi có `retryable === false`).
 * - Trả về `null` nếu không đủ thông tin để kết luận.
 */
export function classifyTransientError(err: unknown): boolean | null {
  if (err === null || err === undefined) return false;

  if (typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (typeof rec['retryable'] === 'boolean') {
      return rec['retryable'];
    }
    if (rec['name'] === 'ZodError' && Array.isArray(rec['issues'])) {
      return false;
    }
  }

  if (err instanceof AppException) {
    const s = err.statusCode;
    if (
      s === HTTP_STATUS_CODE.REQUEST_TIMEOUT ||
      s === HTTP_STATUS_CODE.TOO_MANY_REQUESTS ||
      s === HTTP_STATUS_CODE.SERVICE_UNAVAILABLE ||
      s === HTTP_STATUS_CODE.GATEWAY_TIMEOUT ||
      s === 502
    ) {
      return true;
    }
    if (
      s >= 400 &&
      s < 500 &&
      (err.category === ERROR_CATEGORY.CLIENT || err.category === ERROR_CATEGORY.DOMAIN)
    ) {
      return false;
    }
  }

  return null;
}

export interface DynamicSettingReadOptions {
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly round?: boolean | undefined;
  readonly registry?: SettingRegistryService | undefined;
  readonly context?: SettingResolveContext | undefined;
}

function isDynamicSettingCustomized(
  registry: SettingRegistryService,
  key: string,
  context?: SettingResolveContext,
): { customized: boolean; value: unknown } {
  const def = registry.getDefinition(key);
  if (!def) {
    return { customized: false, value: undefined };
  }
  const resolved = registry.resolve<unknown>(key, context, { maskSensitive: false });
  if (!resolved) {
    return { customized: false, value: undefined };
  }
  const hasScopeOverride =
    resolved.resolvedSource !== 'GLOBAL' && resolved.resolvedSource !== 'DEFAULT';
  const modifiedGlobally =
    def.globalSerializedValue !== def.defaultSerializedValue || def.updatedBy !== null;
  return {
    customized: hasScopeOverride || modifiedGlobally,
    value: resolved.value,
  };
}

/**
 * Đọc cấu hình số động từ `SettingRegistryService` (khi quản trị viên đã tùy chỉnh trên UI Settings hoặc có scope override),
 * ngược lại ưu tiên giá trị `.env` (`envFallback`). Luôn kẹp trong biên `[min, max]`.
 */
export function readDynamicResilienceNumber(
  key: string,
  envFallback: number,
  options?: DynamicSettingReadOptions,
): number {
  const reg = options?.registry ?? defaultSettingRegistry;
  const { customized, value } = isDynamicSettingCustomized(reg, key, options?.context);
  const raw =
    customized && typeof value === 'number' && Number.isFinite(value) ? value : envFallback;
  const normalized = options?.round ? Math.round(raw) : raw;
  const min = options?.min ?? -Infinity;
  const max = options?.max ?? Infinity;
  return Math.max(min, Math.min(max, normalized));
}

/**
 * Đọc cấu hình boolean động từ `SettingRegistryService` (nếu đã tùy chỉnh), ngược lại fallback về `.env`.
 */
export function readDynamicResilienceBoolean(
  key: string,
  envFallback: boolean,
  options?: Pick<DynamicSettingReadOptions, 'registry' | 'context'>,
): boolean {
  const reg = options?.registry ?? defaultSettingRegistry;
  const { customized, value } = isDynamicSettingCustomized(reg, key, options?.context);
  return customized && typeof value === 'boolean' ? value : envFallback;
}
