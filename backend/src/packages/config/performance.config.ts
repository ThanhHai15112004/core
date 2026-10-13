import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};

/** Cặp ngưỡng cảnh báo/nghiêm trọng của một rule hiệu năng. */
const level = (key: string, warn: number, crit: number) => ({
  warn: numberOr(`PERF_${key}_WARN`, warn),
  crit: numberOr(`PERF_${key}_CRIT`, crit),
});

/**
 * Rule phát hiện nghẽn trên số đo Prometheus (HTTP, process, database, queue, worker) và mục tiêu hiệu năng.
 * Monitor trong API đánh giá rule mỗi `evaluateMs` và ghi sự kiện bắt đầu / nặng thêm / hồi phục.
 */
export const performanceConfig = () => ({
  /** Chu kỳ đánh giá rule để ghi sự kiện bắt đầu/hồi phục nghẽn. */
  evaluateMs: numberOr('PERF_EVALUATE_MS', 30_000),
  /** Số sự kiện nghẽn giữ lại (list Redis có giới hạn). */
  eventLogSize: numberOr('PERF_EVENT_LOG_SIZE', 1000),
  rules: {
    apiP95Ms: level('API_P95_MS', 500, 1000),
    apiP99Ms: level('API_P99_MS', 1000, 2000),
    errorRatePercent: level('ERROR_RATE_PERCENT', 2, 10),
    cpuPercent: level('CPU_PERCENT', 75, 90),
    memoryPercent: level('MEMORY_PERCENT', 80, 90),
    eventLoopP99Ms: level('EVENT_LOOP_MS', 100, 250),
    /** Tổng thời gian GC pause mỗi phút. */
    gcPauseMsPerMin: level('GC_PAUSE_MS_PER_MIN', 1000, 3000),
    /** Thời gian trung bình mỗi query (delta digest của database — không có phân vị). */
    dbAvgMs: level('DB_AVG_MS', 300, 1000),
    dbPoolPercent: level('DB_POOL_PERCENT', 85, 95),
    queueWaiting: level('QUEUE_WAITING', 500, 2000),
    workerFailedPercent: level('WORKER_FAILED_PERCENT', 5, 20),
    /** CPU phải vượt ngưỡng liên tục bằng chừng này mới tính là nghẽn (tránh báo đỉnh nhất thời). */
    cpuSustainMin: numberOr('PERF_CPU_SUSTAIN_MIN', 2),
    memoryGrowthWindowMin: numberOr('PERF_MEMORY_GROWTH_WINDOW_MIN', 30),
    memoryGrowthMinMb: numberOr('PERF_MEMORY_GROWTH_MB', 100),
    /** Ít mẫu hơn thì không kết luận. */
    minRequests: numberOr('PERF_MIN_REQUESTS', 20),
    minQueries: numberOr('PERF_MIN_QUERIES', 20),
  },
  /** Mục tiêu hiệu năng (performance budget) — dùng để hiển thị ✓/✕, không phải ngưỡng cảnh báo. */
  budgets: {
    apiP95Ms: numberOr('PERF_BUDGET_API_P95_MS', 200),
    apiP99Ms: numberOr('PERF_BUDGET_API_P99_MS', 500),
    errorRatePercent: numberOr('PERF_BUDGET_ERROR_RATE_PERCENT', 1),
    cpuPercent: numberOr('PERF_BUDGET_CPU_PERCENT', 75),
    memoryPercent: numberOr('PERF_BUDGET_MEMORY_PERCENT', 80),
  },
});

export type PerformanceConfig = ReturnType<typeof performanceConfig>;
export type RuleLevel = { warn: number; crit: number };
