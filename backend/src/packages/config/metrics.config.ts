import { env } from './env.js';

/** Chuyển đổi giá trị sang kiểu số hoặc trả về giá trị mặc định */
const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};

/** Chuyển đổi giá trị sang kiểu boolean hoặc trả về giá trị mặc định */
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

/** Phân tách biến môi trường dạng danh sách chuỗi CSV */
const csvList = (key: string, fallback: readonly string[]): string[] => {
  const raw = env(key, false);
  if (!raw.trim()) return [...fallback];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

/** Phân tách biến môi trường dạng danh sách số nguyên CSV */
const csvNumbers = (key: string): number[] =>
  csvList(key, [])
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);

/**
 * Metrics (prom-client) & Prometheus. Mỗi runtime expose `/metrics`; Prometheus chạy nền scrape và giữ lịch sử,
 * System Console đọc lại bằng PromQL qua `PROMETHEUS_URL` (trống = không có lịch sử, biểu đồ hiện "không khả dụng").
 */
export const metricsConfig = () => {
  const nodeEnv = (env('NODE_ENV', false) || 'development').toLowerCase();
  return {
    prometheusUrl: (env('PROMETHEUS_URL', false) || '').replace(/\/+$/, ''),
    /** Cổng HTTP `/metrics` của runtime không có HTTP server (worker/scheduler); 0 = dùng cổng mặc định của runtime. */
    port: numberOr('METRICS_PORT', 0),
    queryTimeoutMs: numberOr('PROMETHEUS_TIMEOUT_MS', 3000),
    alerts: {
      enabled: booleanOr('METRICS_ALERTS_ENABLED', nodeEnv !== 'test'),
      evaluateMs: Math.max(5000, numberOr('METRICS_ALERTS_EVALUATE_MS', 30_000)),
      defaultCooldownSec: Math.max(10, numberOr('METRICS_ALERTS_DEFAULT_COOLDOWN_SEC', 300)),
      webhookTimeoutMs: Math.max(500, numberOr('METRICS_ALERTS_WEBHOOK_TIMEOUT_MS', 5000)),
      webhookSecret: env('ALERT_WEBHOOK_SECRET', false) || '',
      webhooks: {
        info: env('ALERT_WEBHOOK_INFO_URL', false) || '',
        warning: env('ALERT_WEBHOOK_WARNING_URL', false) || '',
        critical: env('ALERT_WEBHOOK_CRITICAL_URL', false) || '',
      },
      notifyRoleCodes: csvList('ALERT_NOTIFY_ROLE_CODES', []),
      notifyUserIds: csvNumbers('ALERT_NOTIFY_USER_IDS'),
      notifyChannels: csvList('ALERT_NOTIFY_CHANNELS', ['IN_APP', 'EMAIL']),
    },
  };
};

export type MetricsConfig = ReturnType<typeof metricsConfig>;
