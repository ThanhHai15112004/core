import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

const LEVELS = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type LogsBaseLevel = (typeof LEVELS)[number];

/**
 * Logs (Investigation Center): level mặc định, định dạng console, ngưỡng nhận diện bất thường và quyền thao tác (đổi
 * level tạm thời, export). Log nằm trong Redis Stream chung `logs:<env>` (`MAXLEN ~ LOGS_STREAM_MAXLEN`).
 */
export const logsConfig = () => {
  const level = (env('LOG_LEVEL', false) || 'INFO').toUpperCase() as LogsBaseLevel;
  const format = (env('LOG_FORMAT', false) || 'text').toLowerCase();
  return {
    /** Level khi runtime khởi động (đổi tạm thời được từ System Console). */
    level: LEVELS.includes(level) ? level : ('INFO' as LogsBaseLevel),
    /** `json`: mỗi log một dòng JSON trên stdout (cho collector như Loki / Fluent Bit); `text`: dễ đọc. */
    format: (format === 'json' ? 'json' : 'text') as 'json' | 'text',
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
