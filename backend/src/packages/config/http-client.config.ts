import { env } from './env.js';

/** Chuyển đổi giá trị sang kiểu số hoặc trả về giá trị mặc định */
const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};

/** Chuyển đổi giá trị sang kiểu boolean hoặc trả về giá trị mặc định */
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

/** Cấu hình HTTP Client dùng chung (timeout, retry, backoff, circuit breaker & ops) */
export const httpClientConfig = () => {
  return {
    /** Timeout mặc định (ms) cho mỗi outbound HTTP request để không chờ vô hạn */
    defaultTimeoutMs: Math.max(100, numberOr('HTTP_CLIENT_TIMEOUT_MS', 10_000)),
    retry: {
      /** Số lần thử lại tối đa khi gặp lỗi tạm thời (không tính lần gọi đầu) */
      maxRetries: Math.min(10, Math.max(0, numberOr('HTTP_CLIENT_RETRY_MAX', 2))),
      /** Độ trễ cơ sở (ms) trước khi thử lại lần đầu */
      baseDelayMs: Math.max(10, numberOr('HTTP_CLIENT_RETRY_BASE_DELAY_MS', 250)),
      /** Trần thời gian chờ tối đa (ms) cho exponential backoff */
      maxDelayMs: Math.max(100, numberOr('HTTP_CLIENT_RETRY_MAX_DELAY_MS', 5_000)),
      /** Áp dụng jitter để tránh bão retry đồng thời */
      jitter: booleanOr('HTTP_CLIENT_RETRY_JITTER', true),
      /** Tôn trọng header Retry-After khi nhận 429/503 */
      respectRetryAfter: booleanOr('HTTP_CLIENT_RETRY_RESPECT_RETRY_AFTER', true),
      /** Cho phép retry method không idempotent (như POST) khi không có Idempotency-Key */
      retryNonIdempotent: booleanOr('HTTP_CLIENT_RETRY_NON_IDEMPOTENT', false),
    },
    circuitBreaker: {
      /** Bật/tắt Circuit Breaker theo từng dịch vụ */
      enabled: booleanOr('HTTP_CLIENT_CB_ENABLED', true),
      /** Số lỗi tạm thời/mạng trong cửa sổ để mở mạch */
      failureThreshold: Math.max(1, numberOr('HTTP_CLIENT_CB_FAILURE_THRESHOLD', 5)),
      /** Cửa sổ đếm lỗi liên tiếp (ms) */
      failureWindowMs: Math.max(1_000, numberOr('HTTP_CLIENT_CB_FAILURE_WINDOW_MS', 60_000)),
      /** Thời gian giữ mạch ở trạng thái OPEN trước khi chuyển sang HALF_OPEN (ms) */
      resetTimeoutMs: Math.max(1_000, numberOr('HTTP_CLIENT_CB_RESET_TIMEOUT_MS', 30_000)),
      /** Số lượng request thăm dò tối đa khi mạch ở trạng thái HALF_OPEN */
      halfOpenMaxProbes: Math.max(1, numberOr('HTTP_CLIENT_CB_HALF_OPEN_PROBES', 1)),
    },
    logging: {
      /** Ghi log metadata outbound HTTP (URL/headers đã được redact) */
      enabled: booleanOr('HTTP_CLIENT_LOG_ENABLED', true),
      /** Độ dài tối đa đoạn trích response lỗi lưu log */
      maxErrorBodyLength: Math.max(64, numberOr('HTTP_CLIENT_MAX_ERROR_BODY_LENGTH', 256)),
    },
    /** JSON map cấu hình ghi đè theo từng dịch vụ (`{ "payment": { "timeoutMs": 5000 } }`) */
    servicesJson: env('HTTP_CLIENT_SERVICES_JSON', false),
    /** Cho phép đặt lại Circuit Breaker thủ công từ System Console */
    opsResetEnabled: booleanOr('OPS_HTTP_CLIENT_RESET_ENABLED', true),
  };
};

export type HttpClientConfig = ReturnType<typeof httpClientConfig>;
