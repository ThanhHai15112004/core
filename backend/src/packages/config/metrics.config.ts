import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};

/**
 * Metrics (prom-client) & Prometheus. Mỗi runtime expose `/metrics`; Prometheus chạy nền scrape và giữ lịch sử,
 * System Console đọc lại bằng PromQL qua `PROMETHEUS_URL` (trống = không có lịch sử, biểu đồ hiện "không khả dụng").
 */
export const metricsConfig = () => ({
  prometheusUrl: (env('PROMETHEUS_URL', false) || '').replace(/\/+$/, ''),
  /** Cổng HTTP `/metrics` của runtime không có HTTP server (worker/scheduler); 0 = dùng cổng mặc định của runtime. */
  port: numberOr('METRICS_PORT', 0),
  queryTimeoutMs: numberOr('PROMETHEUS_TIMEOUT_MS', 3000),
});

export type MetricsConfig = ReturnType<typeof metricsConfig>;
