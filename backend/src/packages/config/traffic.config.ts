import { env } from './env.js';

/** Chuyển đổi giá trị sang kiểu số hoặc trả về giá trị mặc định */
const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};

/**
 * Ngưỡng phân tích HTTP traffic. Số đo là histogram `http_request_duration_seconds` (hook Fastify, xem
 * `packages/metrics`) đọc bằng PromQL — không còn thu thập/lưu request riêng.
 */
export const trafficConfig = () => ({
  /** P95 tổng vượt mức này (ms) trong 5 phút gần nhất → cảnh báo latency. */
  slowMs: numberOr('TRAFFIC_SLOW_MS', 500),
  /** Module (segment đầu sau API prefix) được coi là traffic nội bộ — có thể ẩn trên UI. */
  internalModules: (env('TRAFFIC_INTERNAL_MODULES', false) || 'ops,health')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  thresholds: {
    endpointP95Ms: numberOr('TRAFFIC_ENDPOINT_P95_WARN_MS', 500),
    errorRateWarnPercent: numberOr('TRAFFIC_ERROR_RATE_WARN_PERCENT', 2),
    errorRateCritPercent: numberOr('TRAFFIC_ERROR_RATE_CRIT_PERCENT', 10),
    spikeIncreasePercent: numberOr('TRAFFIC_SPIKE_INCREASE_PERCENT', 100),
    /** Dưới mức này không kết luận spike (tránh báo động khi traffic quá thấp). */
    minRpsForAlert: numberOr('TRAFFIC_MIN_RPS_FOR_ALERT', 1),
    /** Endpoint có ít request hơn mức này thì chưa đủ dữ liệu để đánh giá. */
    minRequestsForStatus: numberOr('TRAFFIC_MIN_REQUESTS_FOR_STATUS', 20),
  },
});

export type TrafficConfig = ReturnType<typeof trafficConfig>;
