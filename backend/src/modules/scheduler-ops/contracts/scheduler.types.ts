/** Kiểu lịch: biểu thức cron, lặp theo chu kỳ cố định, hoặc chạy một lần. */
export type SchedulerTaskType = 'cron' | 'interval' | 'one_time';
export const SCHEDULER_TASK_TYPES: SchedulerTaskType[] = ['cron', 'interval', 'one_time'];

export type OverlapPolicy = 'skip' | 'allow';
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

export type ExecutionReason =
  'previous_running' | 'lock_unavailable' | 'runtime_down' | 'interrupted';

export interface ScheduleSpec {
  type: SchedulerTaskType;
  cron: string | null;
  intervalMs: number | null;
  runAt: number | null;
  timezone: string;
}

export interface ScheduledTaskMeta extends ScheduleSpec {
  id: string;
  name: string;
  description: string | null;
  group: string;
  overlap: OverlapPolicy;
  misfire: MisfirePolicy;
  expectedDurationMs: number | null;
  lockTtlMs: number;
  downstreamQueue: string | null;
  className: string;
  sourcePath: string | null;
  error: string | null;
  registeredAt: number;
}

export interface GeneratedJobRef {
  id: string;
  queue: string;
  topic: string;
}

export interface ExecutionError {
  type: string;
  message: string;
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  trigger: ExecutionTrigger;
  status: ExecutionStatus;
  scheduledAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  driftMs: number | null;
  instance: string | null;
  correlationId: string | null;
  error: ExecutionError | null;
  reason: ExecutionReason | null;
  missedCount: number | null;
  missedUntil: number | null;
  jobs: GeneratedJobRef[];
  actor: string | null;
  ip: string | null;
  blockedBy: string | null;
}

export interface TaskStateRecord {
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
  completed: boolean;
  updatedAt: number;
}

export interface TaskDisabledRecord {
  at: number;
  actor: string | null;
  ip: string | null;
}

export interface SchedulerInstanceRecord {
  instance: string;
  host: string;
  pid: number;
  startedAt: number;
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
