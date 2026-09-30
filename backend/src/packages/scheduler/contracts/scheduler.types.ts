/** Kiểu lịch: biểu thức cron, lặp theo chu kỳ cố định, hoặc chạy một lần vào thời điểm định trước. */
export type SchedulerTaskType = 'cron' | 'interval' | 'one_time';
export const SCHEDULER_TASK_TYPES: SchedulerTaskType[] = ['cron', 'interval', 'one_time'];

/**
 * Lần chạy kế tiếp tới khi lần trước chưa xong: `skip` (Prevent) — bỏ qua và ghi lịch sử "skipped", có lock
 * phân tán (Redis) nên cũng chặn chạy chồng giữa nhiều instance; `allow` — cho chạy song song.
 */
export type OverlapPolicy = 'skip' | 'allow';

/** Lịch bị lỡ (scheduler ngừng chạy lúc tới hạn): `run_once` — chạy bù đúng một lần khi hồi phục; `skip` — bỏ qua. */
export type MisfirePolicy = 'run_once' | 'skip';

export type ExecutionTrigger = 'scheduled' | 'manual' | 'recovery';
export type ExecutionStatus = 'running' | 'success' | 'failed' | 'skipped' | 'missed';
export const EXECUTION_STATUSES: ExecutionStatus[] = [
  'running',
  'success',
  'failed',
  'skipped',
  'missed',
];
export const EXECUTION_TRIGGERS: ExecutionTrigger[] = ['scheduled', 'manual', 'recovery'];

/** Lý do một lần chạy bị bỏ qua / lỡ lịch. */
export type ExecutionReason =
  'previous_running' | 'lock_unavailable' | 'runtime_down' | 'interrupted';

/** Lịch chạy của task (không có handler) — đủ để tính lần chạy kế tiếp ở bất kỳ process nào. */
export interface ScheduleSpec {
  type: SchedulerTaskType;
  cron: string | null;
  intervalMs: number | null;
  /** epoch ms — chỉ với `one_time`. */
  runAt: number | null;
  timezone: string;
}

/** Định nghĩa task do Scheduler runtime công bố (registry trong Redis) cho System Console đọc. */
export interface ScheduledTaskMeta extends ScheduleSpec {
  id: string;
  name: string;
  description: string | null;
  group: string;
  overlap: OverlapPolicy;
  misfire: MisfirePolicy;
  /** Thời lượng dự kiến (ms); null = suy ra từ lịch sử. */
  expectedDurationMs: number | null;
  lockTtlMs: number;
  /** Queue nhận job do task tạo ra (task chỉ trigger/enqueue, Worker xử lý). */
  downstreamQueue: string | null;
  className: string;
  sourcePath: string | null;
  /** Lịch không hợp lệ (cron sai, múi giờ sai…) → task không được lên lịch. */
  error: string | null;
  registeredAt: number;
}

/** Job do một lần chạy tạo ra (nối Scheduler → Queue → Worker). */
export interface GeneratedJobRef {
  id: string;
  queue: string;
  topic: string;
}

export interface ExecutionError {
  /** Loại lỗi đã chuẩn hoá (`StorageTimeout`, `EnqueueFailure`, `UnhandledException`…). */
  type: string;
  message: string;
}

/** Một lần thực thi (hoặc một lần bị bỏ qua / lỡ lịch) của task. */
export interface ExecutionRecord {
  id: string;
  taskId: string;
  trigger: ExecutionTrigger;
  status: ExecutionStatus;
  /** epoch ms — thời điểm theo lịch (null với chạy thủ công). */
  scheduledAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  /** Bắt đầu trễ bao nhiêu so với lịch. */
  driftMs: number | null;
  /** `host:pid` của scheduler instance đã chạy. */
  instance: string | null;
  correlationId: string | null;
  error: ExecutionError | null;
  reason: ExecutionReason | null;
  /** Lần chạy bị lỡ gộp chung một bản ghi (vd. scheduler ngừng 2 giờ với task 5 phút → 24). */
  missedCount: number | null;
  /** epoch ms — lịch cuối cùng bị lỡ (với bản ghi `missed`). */
  missedUntil: number | null;
  jobs: GeneratedJobRef[];
  /** Người bấm Run Now (chưa có RBAC → null) và IP đã che. */
  actor: string | null;
  ip: string | null;
  /** Execution đang giữ lock khi bản ghi này bị bỏ qua. */
  blockedBy: string | null;
}

/** Trạng thái chạy gần nhất của task (do runtime cập nhật sau mỗi lần chạy). */
export interface TaskStateRecord {
  /** epoch ms — lần chạy kế tiếp đã lên lịch; null = không lên lịch (tắt / tạm dừng / đã xong). */
  nextRunAt: number | null;
  lastScheduledAt: number | null;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  lastStatus: ExecutionStatus | null;
  lastExecutionId: string | null;
  lastDurationMs: number | null;
  lastError: ExecutionError | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  /** Task `one_time` đã chạy xong. */
  completed: boolean;
  updatedAt: number;
}

export interface TaskDisabledRecord {
  at: number;
  actor: string | null;
  ip: string | null;
}

/** Scheduler instance tự báo (mỗi instance một bản ghi — hỗ trợ chạy nhiều instance với lock phân tán). */
export interface SchedulerInstanceRecord {
  instance: string;
  host: string;
  pid: number;
  startedAt: number;
  /** epoch ms — heartbeat gần nhất. */
  at: number;
  paused: boolean;
  timezone: string;
  tasks: number;
  running: number;
}

export type SchedulerCommandAction = 'run' | 'refresh';

export interface SchedulerCommand {
  id: string;
  action: SchedulerCommandAction;
  taskId: string | null;
  /** Execution id do API cấp trước (Run Now) để trả về ngay cho người bấm. */
  executionId: string | null;
  actor: string | null;
  ip: string | null;
  requestedAt: number;
}

export interface SchedulerCommandResult {
  id: string;
  status: 'accepted' | 'rejected';
  code: string | null;
  instance: string;
  executionId: string | null;
  params: Record<string, string | number>;
  at: number;
}

export type SchedulerEventType =
  | 'instance_started'
  | 'instance_stopped'
  | 'task_failed'
  | 'task_recovered'
  | 'run_missed'
  | 'run_skipped'
  | 'run_recovered'
  | 'execution_interrupted'
  | 'manual_run'
  | 'task_enabled'
  | 'task_disabled'
  | 'duplicate_execution'
  | 'alert_started'
  | 'alert_recovered';

export interface SchedulerEventRecord {
  id: string;
  /** epoch ms */
  at: number;
  type: SchedulerEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  taskId: string | null;
  executionId: string | null;
  params: Record<string, string | number>;
}

export type SchedulerOperationAction = 'run' | 'enable' | 'disable';

export interface SchedulerOperationRecord {
  id: string;
  at: number;
  action: SchedulerOperationAction;
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
  executionId: string | null;
}
