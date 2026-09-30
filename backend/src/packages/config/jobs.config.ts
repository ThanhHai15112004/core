import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

/**
 * Jobs (Job Explorer): ngưỡng nhận diện job bất thường, retention của chỉ mục tìm kiếm / bản ghi huỷ, và quyền thao
 * tác từng job. Retention của chính job (completed / failed) do BullMQ giữ theo `MESSAGING_KEEP_*`.
 */
export const jobsConfig = () => ({
  rules: {
    /** Job chạy lâu hơn `factor × p95` của loại job (tối thiểu `minSec`) → "chạy lâu" (chưa phải stalled). */
    longRunningFactor: numberOr('JOBS_LONG_RUNNING_FACTOR', 3),
    longRunningMinSec: numberOr('JOBS_LONG_RUNNING_MIN_SEC', 60),
    /** Job chờ lâu hơn `factor × thời gian chờ trung bình` của queue (tối thiểu `minSec`) → "chờ lâu". */
    longWaitFactor: numberOr('JOBS_LONG_WAIT_FACTOR', 10),
    longWaitMinSec: numberOr('JOBS_LONG_WAIT_MIN_SEC', 60),
    /** Số job lỗi trong 1 giờ ≥ chừng này → vấn đề hiện tại. */
    failuresPerHourWarn: numberOr('JOBS_FAILURES_PER_HOUR_WARN', 10),
    /** Một nhóm lỗi (cùng loại) có ≥ chừng này job → nêu tên nguyên nhân. */
    errorGroupWarn: numberOr('JOBS_ERROR_GROUP_WARN', 5),
    /** Job ưu tiên cao chờ quá chừng này (giây) → cảnh báo. */
    criticalWaitSec: numberOr('JOBS_CRITICAL_WAIT_SEC', 60),
  },
  /** Chỉ mục tìm kiếm (correlation / request / idempotency / entity ID → job) và bản ghi job đã huỷ. */
  indexRetentionDays: Math.max(1, numberOr('JOBS_INDEX_RETENTION_DAYS', 7)),
  cancelledRetentionDays: Math.max(1, numberOr('JOBS_CANCELLED_RETENTION_DAYS', 7)),
  /** Số job tối đa một lần tìm kiếm được đọc từ broker (không quét vô hạn). */
  searchScanMax: Math.max(100, numberOr('JOBS_SEARCH_SCAN_MAX', 2000)),
  /** Retry một job lỗi. */
  retry: booleanOr('OPS_JOBS_RETRY_ENABLED', true),
  /** Retry nhiều job lỗi đã chọn (có xem trước) — tối đa `bulkRetryMax` mỗi lần. */
  bulkRetryMax: Math.max(1, numberOr('OPS_JOBS_BULK_RETRY_MAX', 50)),
  /** Huỷ job chưa chạy / yêu cầu huỷ job đang chạy (chỉ processor hỗ trợ huỷ hợp tác). */
  cancel: booleanOr('OPS_JOBS_CANCEL_ENABLED', true),
  /** Xoá bản ghi job đã xong / lỗi — không hoàn tác nghiệp vụ đã chạy; mặc định tắt. */
  remove: booleanOr('OPS_JOBS_REMOVE_ENABLED', false),
  /** Xem payload (đã che field nhạy cảm) — quyền riêng, mỗi lần xem được ghi audit. */
  payload: booleanOr('OPS_JOBS_PAYLOAD_ENABLED', true),
});

export type JobsConfig = ReturnType<typeof jobsConfig>;
