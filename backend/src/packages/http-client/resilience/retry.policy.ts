import type { HttpMethod, HttpRetryPolicy } from '../contracts/http-client.contract.js';
import type { HttpClientError } from '../errors/http-client.errors.js';

const IDEMPOTENT_METHODS: ReadonlySet<HttpMethod> = new Set([
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
  'OPTIONS',
]);

/** Kiểm tra method HTTP có tính chất idempotent (an toàn để retry mặc định) */
export function isIdempotentMethod(method: HttpMethod): boolean {
  return IDEMPOTENT_METHODS.has(method);
}

/** Chỉ coi là lỗi tạm thời có thể retry khi status nằm trong danh sách cho phép (không retry 4xx nghiệp vụ) */
export function shouldRetryStatus(status: number, policy: HttpRetryPolicy): boolean {
  return policy.retryableStatusCodes.includes(status);
}

/** Quyết định có retry hay không dựa trên loại lỗi, HTTP method và Idempotency-Key */
export function shouldRetryError(
  error: HttpClientError,
  method: HttpMethod,
  hasIdempotencyKey: boolean,
  policy: HttpRetryPolicy,
): boolean {
  if (!error.retryable || policy.maxRetries <= 0) {
    return false;
  }
  return isIdempotentMethod(method) || policy.retryNonIdempotent || hasIdempotencyKey;
}

/** Đọc giá trị Retry-After (giây hoặc HTTP date) và giới hạn trong [0, maxDelayMs] */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  maxDelayMs: number,
  nowMs = Date.now(),
): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(maxDelayMs, Math.round(seconds * 1000));
  }

  const parsedDateMs = Date.parse(trimmed);
  if (Number.isNaN(parsedDateMs)) return null;
  const delta = Math.max(0, parsedDateMs - nowMs);
  return Math.min(maxDelayMs, Math.round(delta));
}

/**
 * Tính thời gian chờ tăng dần theo số mũ (exponential backoff) kèm jitter [50%..100%] của cap
 * để giảm tải đồng thời khi nhà cung cấp gặp sự cố.
 */
export function computeBackoffDelayMs(
  attempt: number,
  policy: HttpRetryPolicy,
  retryAfterMs?: number | null,
  randomFn: () => number = Math.random,
): number {
  if (policy.respectRetryAfter && retryAfterMs !== null && retryAfterMs !== undefined) {
    return Math.min(policy.maxDelayMs, Math.max(0, Math.round(retryAfterMs)));
  }
  const exponent = Math.max(0, attempt - 1);
  const raw = policy.baseDelayMs * Math.pow(2, exponent);
  const cap = Math.min(policy.maxDelayMs, raw);
  if (!policy.jitter) {
    return Math.round(cap);
  }
  const r = Math.min(1, Math.max(0, randomFn()));
  return Math.round(cap * (0.5 + 0.5 * r));
}

/** Tạm dừng có hỗ trợ hủy sớm khi request bị abort từ caller */
export function sleepWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
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

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted during retry backoff'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
