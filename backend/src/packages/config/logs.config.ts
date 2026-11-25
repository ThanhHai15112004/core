import { env } from './env.js';

/** Chuyển đổi giá trị sang kiểu số hoặc trả về giá trị mặc định */
const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
/** Chuyển đổi giá trị sang kiểu boolean hoặc trả về giá trị mặc định */
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;
/** Phân tách biến môi trường dạng danh sách CSV */
const csvList = (key: string): string[] =>
  env(key, false)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const LEVELS = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type LogsBaseLevel = (typeof LEVELS)[number];

const SINK_DRIVERS = ['none', 'loki', 'opensearch', 'siem'] as const;
export type LogSinkDriver = (typeof SINK_DRIVERS)[number];

/**
 * Logs (Investigation Center): level mặc định, định dạng console, ngưỡng nhận diện bất thường và quyền thao tác (đổi
 * level tạm thời, export). Log nằm trong Redis Stream chung `logs:<env>` (`MAXLEN ~ LOGS_STREAM_MAXLEN`).
 */
export const logsConfig = () => {
  const level = (env('LOG_LEVEL', false) || 'INFO').toUpperCase() as LogsBaseLevel;
  const format = (env('LOG_FORMAT', false) || 'text').toLowerCase();
  const driverRaw = (env('LOG_SINK_DRIVER', false) || 'none').toLowerCase();
  const driver = (
    SINK_DRIVERS.includes(driverRaw as LogSinkDriver) ? driverRaw : 'none'
  ) as LogSinkDriver;
  return {
    /** Level khi runtime khởi động (đổi tạm thời được từ System Console). */
    level: LEVELS.includes(level) ? level : ('INFO' as LogsBaseLevel),
    /** `json`: mỗi log một dòng JSON trên stdout (cho collector như Loki / Fluent Bit); `text`: dễ đọc. */
    format: (format === 'json' ? 'json' : 'text') as 'json' | 'text',
    /** Tên service gắn vào structured log (`LOG_SERVICE_NAME` → `APP_NAME` → `core-app`). */
    serviceName: env('LOG_SERVICE_NAME', false) || env('APP_NAME', false) || 'core-app',
    /** Ngưỡng ms cảnh báo HTTP request xử lý chậm (0 = tắt). */
    slowRequestMs: Math.max(0, numberOr('LOG_SLOW_REQUEST_MS', 1000)),
    redaction: {
      /** Danh sách tên field bổ sung cần che ngoài bộ mặc định (CSV). */
      extraKeys: csvList('LOG_REDACT_EXTRA_KEYS'),
    },
    requestBody: {
      /** Bật/tắt ghi nhận các field được cho phép của request body trong HTTP log (mặc định tắt). */
      enabled: booleanOr('LOG_REQUEST_BODY_ENABLED', false),
      /** Danh sách field / đường dẫn dot-notation được phép ghi nhận từ request body (CSV). */
      allowlist: csvList('LOG_REQUEST_BODY_ALLOWLIST'),
      /** Kích thước tối đa (byte) của request body trích xuất vào log. */
      maxBytes: Math.max(256, numberOr('LOG_REQUEST_BODY_MAX_BYTES', 2048)),
    },
    sink: {
      /** Bật/tắt gửi log tập trung sang Loki / OpenSearch / SIEM (dự án nhỏ mặc định tắt). */
      enabled: booleanOr('LOG_SINK_ENABLED', false),
      driver,
      endpoint: env('LOG_SINK_ENDPOINT', false),
      authHeader: env('LOG_SINK_AUTH_HEADER', false),
      apiKey: env('LOG_SINK_API_KEY', false),
      tenantId: env('LOG_SINK_TENANT_ID', false),
      indexPrefix: env('LOG_SINK_INDEX_PREFIX', false) || 'app-logs',
      batchSize: Math.max(1, numberOr('LOG_SINK_BATCH_SIZE', 100)),
      flushMs: Math.max(200, numberOr('LOG_SINK_FLUSH_MS', 2000)),
      timeoutMs: Math.max(500, numberOr('LOG_SINK_TIMEOUT_MS', 5000)),
      maxBuffer: Math.max(100, numberOr('LOG_SINK_MAX_BUFFER', 5000)),
    },
    rules: {
      /** Nhóm lỗi: nửa sau khoảng đang xem ≥ `factor ×` nửa đầu và ≥ `minPerMin` lỗi/phút → spike. */
      spikeFactor: numberOr('LOGS_SPIKE_FACTOR', 3),
      spikeMinPerMin: numberOr('LOGS_SPIKE_MIN_PER_MIN', 5),
      /** Nhóm lỗi xuất hiện lần đầu trong chừng này phút → "lỗi mới". */
      newErrorMin: numberOr('LOGS_NEW_ERROR_MIN', 30),
      /** Tỉ lệ error / tổng log ≥ chừng này % → cảnh báo. */
      errorRateWarnPercent: numberOr('LOGS_ERROR_RATE_WARN_PERCENT', 5),
    },
    /** Export theo bộ lọc hiện tại (JSON / CSV / NDJSON) — tối đa `exportMax` dòng, mỗi lần export có audit. */
    export: booleanOr('OPS_LOGS_EXPORT_ENABLED', true),
    exportMax: Math.max(100, numberOr('OPS_LOGS_EXPORT_MAX', 10000)),
    /** Đổi log level runtime từ System Console (tạm thời, tự hết hạn). */
    levelChange: booleanOr('OPS_LOGS_LEVEL_ENABLED', true),
    /** Cho phép chọn "tới khi đổi lại" (không tự hết hạn) — mặc định tắt để không ai quên DEBUG. */
    levelPermanent: booleanOr('OPS_LOGS_LEVEL_PERMANENT_ENABLED', false),
    /** Xem structured metadata và stack trace (đã redact) trong chi tiết log. */
    details: booleanOr('OPS_LOGS_DETAILS_ENABLED', true),
    /** Xem audit log (thao tác vận hành trên toàn System Console). */
    audit: booleanOr('OPS_LOGS_AUDIT_ENABLED', true),
  };
};

export type LogsConfig = ReturnType<typeof logsConfig>;
