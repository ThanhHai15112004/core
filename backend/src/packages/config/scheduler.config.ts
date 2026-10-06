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

/**
 * Scheduler (BullMQ Job Scheduler): múi giờ lịch chạy, ngưỡng giám sát và quyền thao tác từ System Console. Lịch sử
 * thực thi là job còn giữ trên broker (retention của messaging) — không lưu riêng.
 */
export const schedulerConfig = () => ({
  /** Múi giờ mặc định của lịch cron (task có thể khai báo riêng). */
  timezone: timezoneOr('SCHEDULER_TIMEZONE'),
  rules: {
    /** Không nhận heartbeat của scheduler instance nào quá chừng này (giây) → runtime down. */
    heartbeatTimeoutSec: numberOr('SCHEDULER_HEARTBEAT_TIMEOUT_SEC', 30),
    /** Số lần lỗi liên tiếp → cảnh báo / nghiêm trọng. */
    consecutiveFailuresWarn: numberOr('SCHEDULER_CONSECUTIVE_FAILURES_WARN', 2),
    consecutiveFailuresCrit: numberOr('SCHEDULER_CONSECUTIVE_FAILURES_CRIT', 5),
    /** Số lần chạy lỗi trong 1 giờ (mọi task) → scheduler degraded. */
    recentFailuresWarn: numberOr('SCHEDULER_RECENT_FAILURES_WARN', 3),
    /** Số task khác nhau cùng rơi vào một cửa sổ 5 phút → cảnh báo dồn lịch. */
    concentrationTasks: numberOr('SCHEDULER_CONCENTRATION_TASKS', 5),
  },
  /** Run Now từ System Console. */
  run: booleanOr('OPS_SCHEDULER_RUN_ENABLED', true),
  /** Enable / Disable task từ System Console. */
  toggle: booleanOr('OPS_SCHEDULER_TOGGLE_ENABLED', true),
});

export type SchedulerConfig = ReturnType<typeof schedulerConfig>;
