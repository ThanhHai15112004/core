import os from 'node:os';
import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

/** Cấu hình thu thập & phân tích HTTP traffic (dùng cho app có HTTP server). */
export const trafficConfig = () => ({
  /** Tắt thì vẫn đếm metric trong RAM cho runtime card nhưng không ghi Redis. */
  enabled: booleanOr('TRAFFIC_ENABLED', true),
  /** Tên instance trong bộ lọc; mặc định hostname (trong Docker là container id). */
  instanceId: env('TRAFFIC_INSTANCE_ID', false) || os.hostname(),
  flushMs: numberOr('TRAFFIC_FLUSH_MS', 5000),
  slowMs: numberOr('TRAFFIC_SLOW_MS', 500),
  longRunningMs: numberOr('TRAFFIC_LONG_RUNNING_MS', 3000),
  /** Tỷ lệ request bình thường được lưu chi tiết (0–1); request chậm/lỗi luôn được lưu. */
  sampleRate: Math.min(1, Math.max(0, numberOr('TRAFFIC_SAMPLE_RATE', 0.01))),
  captureBodies: booleanOr('TRAFFIC_CAPTURE_BODIES', true),
  maxBodyBytes: numberOr('TRAFFIC_MAX_BODY_BYTES', 8192),
  requestLogSize: numberOr('TRAFFIC_REQUEST_LOG_SIZE', 5000),
  /** Glob, phân tách bằng dấu phẩy, vd `/api/v1/health*`. */
  excludeRoutes: (env('TRAFFIC_EXCLUDE_ROUTES', false) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Preflight CORS mặc định không tính là traffic nghiệp vụ. */
  excludeMethods: (env('TRAFFIC_EXCLUDE_METHODS', false) || 'OPTIONS')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
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
