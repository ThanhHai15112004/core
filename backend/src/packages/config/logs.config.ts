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
 * Logs (Investigation Center): level mặc định, định dạng console, ngưỡng nhận diện bất thường, giữ nhóm lỗi và quyền
 * thao tác (đổi level tạm thời, export). Số log giữ để tìm kiếm là ring buffer mỗi runtime `RUNTIME_LOG_RETENTION`.
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
      /** Lỗi/phút 5 phút gần nhất ≥ `factor × baseline` (60 phút trước đó) và ≥ `minPerMin` → spike. */
      spikeFactor: numberOr('LOGS_SPIKE_FACTOR', 3),
      spikeMinPerMin: numberOr('LOGS_SPIKE_MIN_PER_MIN', 5),
      /** Nhóm lỗi xuất hiện lần đầu trong chừng này phút → "lỗi mới". */
      newErrorMin: numberOr('LOGS_NEW_ERROR_MIN', 30),
      /** Tỉ lệ error / tổng log ≥ chừng này % → cảnh báo. */
      errorRateWarnPercent: numberOr('LOGS_ERROR_RATE_WARN_PERCENT', 5),
      /** Log/phút ≥ `factor × baseline` và ≥ `minPerMin` → volume cao bất thường. */
      highVolumeFactor: numberOr('LOGS_HIGH_VOLUME_FACTOR', 5),
      highVolumeMinPerMin: numberOr('LOGS_HIGH_VOLUME_MIN_PER_MIN', 1000),
    },
    /** Giữ thông tin nhóm lỗi (lần đầu / lần cuối / số lần) chừng này ngày kể từ lần cuối xuất hiện. */
    errorGroupRetentionDays: Math.max(1, numberOr('LOGS_ERROR_GROUP_RETENTION_DAYS', 7)),
    /** Số nhóm lỗi tối đa được theo dõi (nhóm cũ nhất bị bỏ trước). */
    errorGroupMax: Math.max(50, numberOr('LOGS_ERROR_GROUP_MAX', 500)),
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
