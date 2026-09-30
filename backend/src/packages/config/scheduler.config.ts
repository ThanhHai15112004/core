import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

/** Múi giờ hợp lệ theo IANA (Intl hiểu được); sai → dùng múi giờ của process. */
function timezoneOr(key: string): string {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const raw = env(key, false).trim();
  if (!raw) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return fallback;
  }
}

/** Scheduler: múi giờ lịch chạy, lưu lịch sử thực thi, ngưỡng giám sát và quyền thao tác từ System Console. */
export const schedulerConfig = () => ({
  /** Múi giờ mặc định của lịch cron (task có thể khai báo riêng). */
  timezone: timezoneOr('SCHEDULER_TIMEZONE'),
  /** Lịch sử thực thi chi tiết giữ bao nhiêu ngày (số đo tổng hợp theo telemetry — 8 ngày). */
  historyRetentionDays: Math.max(1, numberOr('SCHEDULER_HISTORY_RETENTION_DAYS', 7)),
  /** Số lần chạy tối đa giữ cho mỗi task (task chạy dày không làm phình Redis). */
  historyMaxPerTask: Math.max(100, numberOr('SCHEDULER_HISTORY_MAX_PER_TASK', 2000)),
  /** TTL mặc định của lock chống chạy chồng (được gia hạn khi task còn chạy). */
  lockTtlMs: Math.max(5000, numberOr('SCHEDULER_LOCK_TTL_MS', 10 * 60_000)),
  rules: {
    /** Không nhận heartbeat của scheduler instance nào quá chừng này (giây) → runtime down. */
    heartbeatTimeoutSec: numberOr('SCHEDULER_HEARTBEAT_TIMEOUT_SEC', 30),
    /** Số lần lỗi liên tiếp → cảnh báo / nghiêm trọng. */
    consecutiveFailuresWarn: numberOr('SCHEDULER_CONSECUTIVE_FAILURES_WARN', 2),
    consecutiveFailuresCrit: numberOr('SCHEDULER_CONSECUTIVE_FAILURES_CRIT', 5),
    /** Số lần chạy lỗi trong 1 giờ (mọi task) → scheduler degraded. */
    recentFailuresWarn: numberOr('SCHEDULER_RECENT_FAILURES_WARN', 3),
    /** Task không khai báo thời lượng dự kiến: chạy lâu hơn p95 lịch sử × hệ số này → có thể bị treo. */
    longRunningFactor: numberOr('SCHEDULER_LONG_RUNNING_FACTOR', 3),
    /** Ngưỡng tối thiểu (giây) trước khi coi một lần chạy là "chạy lâu bất thường". */
    longRunningMinSec: numberOr('SCHEDULER_LONG_RUNNING_MIN_SEC', 60),
    /** Độ trễ bắt đầu so với lịch (p95, 15 phút) → cảnh báo. */
    driftP95Ms: numberOr('SCHEDULER_DRIFT_P95_WARN_MS', 5000),
    /** Số task khác nhau cùng rơi vào một cửa sổ 5 phút → cảnh báo dồn lịch. */
    concentrationTasks: numberOr('SCHEDULER_CONCENTRATION_TASKS', 5),
  },
  /** Run Now từ System Console. */
  run: booleanOr('OPS_SCHEDULER_RUN_ENABLED', true),
  /** Enable / Disable task từ System Console. */
  toggle: booleanOr('OPS_SCHEDULER_TOGGLE_ENABLED', true),
});

export type SchedulerConfig = ReturnType<typeof schedulerConfig>;
