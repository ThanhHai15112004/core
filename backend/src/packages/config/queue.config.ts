import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

/** Worker & Queue Monitor: ngưỡng vận hành (không phải giới hạn cứng của broker) và quyền thao tác queue. */
export const queueConfig = () => ({
  rules: {
    /** Số job chờ (waiting) của một queue → cảnh báo / nghiêm trọng. */
    backlogWarn: numberOr('WORKER_QUEUE_BACKLOG_WARN', 1000),
    backlogCrit: numberOr('WORKER_QUEUE_BACKLOG_CRIT', 5000),
    /** Job chờ lâu nhất quá chừng này (phút) → cảnh báo. */
    oldestWaitingMin: numberOr('WORKER_QUEUE_OLDEST_WAITING_MIN', 10),
    failureRatePercent: numberOr('WORKER_QUEUE_FAILURE_RATE_PERCENT', 5),
    /** Số job tối thiểu trong cửa sổ để kết luận tỉ lệ lỗi / độ chậm. */
    minOps: numberOr('WORKER_QUEUE_RULE_MIN_OPS', 20),
    processingP95Ms: numberOr('WORKER_QUEUE_PROCESSING_P95_MS', 5000),
    /** Job active lâu hơn chừng này (phút) được coi là "treo" (stalled / chạy quá lâu). */
    stalledMin: numberOr('WORKER_QUEUE_STALLED_MIN', 10),
    /** Số lần retry trong 1 phút ≥ chừng này → retry storm. */
    retryStormPerMin: numberOr('WORKER_QUEUE_RETRY_STORM_PER_MIN', 100),
    /** Job đang chạy / concurrency đã cấu hình ≥ chừng này (%) khi còn backlog → gần hết capacity. */
    concurrencyPercent: numberOr('WORKER_QUEUE_CONCURRENCY_PERCENT', 90),
  },
  /** Pause / resume queue (toàn cục trên broker). */
  pause: booleanOr('OPS_QUEUE_PAUSE_ENABLED', true),
  /** Retry hàng loạt job lỗi của một queue (có xem trước). */
  retryFailed: booleanOr('OPS_QUEUE_RETRY_FAILED_ENABLED', true),
  /** Số job lỗi tối đa retry trong một lần thao tác. */
  retryFailedMax: Math.max(1, numberOr('OPS_QUEUE_RETRY_FAILED_MAX', 500)),
  /** Drain (xoá job đang chờ) — nguy hiểm, mặc định tắt. */
  drain: booleanOr('OPS_QUEUE_DRAIN_ENABLED', false),
});

export type QueueConfig = ReturnType<typeof queueConfig>;
