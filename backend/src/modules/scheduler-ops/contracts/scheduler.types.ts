/** Kiểu lịch: biểu thức cron hoặc lặp theo chu kỳ cố định (BullMQ Job Scheduler). */
export type SchedulerTaskType = 'cron' | 'interval';

/** Lần chạy do lịch (Job Scheduler) hay do người vận hành bấm Run Now. */
export type ExecutionTrigger = 'scheduled' | 'manual';
export const EXECUTION_TRIGGERS: ExecutionTrigger[] = ['scheduled', 'manual'];

/**
 * Trạng thái lần chạy = trạng thái job trên BullMQ: `scheduled` (delayed/waiting — chờ tới giờ hoặc chờ worker),
 * `running` (active), `success` (completed), `failed`.
 */
export type ExecutionStatus = 'scheduled' | 'running' | 'success' | 'failed';
export const EXECUTION_STATUSES: ExecutionStatus[] = ['scheduled', 'running', 'success', 'failed'];

export interface GeneratedJobRef {
  id: string;
  queue: string;
  topic: string;
}

export interface ExecutionError {
  type: string;
  message: string;
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
