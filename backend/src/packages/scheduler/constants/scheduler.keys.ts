import type { RedisService } from '@packages/redis/index.js';

/** Key Redis của Scheduler (đã có REDIS_PREFIX). */
export const schedulerKeys = (redis: RedisService) => ({
  /** HASH taskId → ScheduledTaskMeta (registry do runtime công bố lúc khởi động). */
  tasks: () => redis.key('sched', 'tasks'),
  /** HASH taskId → TaskStateRecord. */
  state: () => redis.key('sched', 'state'),
  /** HASH taskId → TaskDisabledRecord (có mặt = đang tắt). */
  disabled: () => redis.key('sched', 'disabled'),
  /** HASH instance → SchedulerInstanceRecord. */
  instances: () => redis.key('sched', 'instances'),
  /** HASH executionId → ExecutionRecord đang chạy. */
  running: () => redis.key('sched', 'running'),
  /** STRING JSON ExecutionRecord (TTL = thời gian giữ lịch sử). */
  execution: (id: string) => redis.key('sched', 'exec', id),
  /** ZSET executionId theo thời điểm (bắt đầu, hoặc theo lịch khi không chạy). */
  executions: () => redis.key('sched', 'execs'),
  taskExecutions: (taskId: string) => redis.key('sched', 'execs', 'task', taskId),
  /** ZSET lần chạy lỗi / lỡ lịch (tab Failures không phải quét toàn bộ lịch sử). */
  problems: () => redis.key('sched', 'execs', 'problems'),
  /** Lock chống chạy chồng của task (value = `executionId|instance`). */
  lock: (taskId: string) => redis.key('sched', 'lock', taskId),
  /** Một lịch (task + thời điểm) chỉ được một instance nhận. */
  slot: (taskId: string, scheduledAt: number) =>
    redis.key('sched', 'slot', taskId, String(scheduledAt)),
  /** Kiểm tra lịch bị lỡ lúc khởi động chỉ làm một lần cho mỗi mốc. */
  missCheck: (taskId: string, since: number) => redis.key('sched', 'miss', taskId, String(since)),
  commandChannel: () => redis.key('sched', 'cmd'),
  commandClaim: (id: string) => redis.key('sched', 'cmdclaim', id),
  commandResult: (id: string) => redis.key('sched', 'cmdres', id),
  /** LIST sự kiện (mới nhất trước). */
  events: () => redis.key('sched', 'events'),
  /** LIST audit thao tác. */
  operations: () => redis.key('sched', 'ops'),
  /** HASH alertId → cảnh báo đang diễn ra. */
  activeAlerts: () => redis.key('sched', 'alerts'),
  monitorLock: () => redis.key('sched', 'lock', 'monitor'),
});

export const SCHEDULER_EVENT_LOG_SIZE = 1000;
export const SCHEDULER_OPERATION_LOG_SIZE = 500;
/** Kết quả lệnh Run Now giữ lại 1 giờ. */
export const SCHEDULER_COMMAND_TTL_SEC = 3600;
/** Tổng số lần chạy tối đa trong chỉ mục toàn cục. */
export const SCHEDULER_GLOBAL_HISTORY_MAX = 50_000;
