export type JobEventType =
  | 'job_failed'
  | 'job_retry_scheduled'
  | 'job_recovered'
  | 'job_stalled'
  | 'job_long_running'
  | 'job_cancelled'
  | 'job_cancel_requested'
  | 'job_retried'
  | 'job_bulk_retried'
  | 'job_removed';

export interface JobEventRecord {
  id: string;
  /** epoch ms */
  at: number;
  type: JobEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  jobId: string | null;
  queue: string | null;
  /** Loại job (topic). */
  jobType: string | null;
  params: Record<string, string | number>;
  runtime: string | null;
}

export type JobOperationAction = 'retry' | 'bulk_retry' | 'cancel' | 'remove' | 'payload';

export interface JobOperationRecord {
  id: string;
  at: number;
  action: JobOperationAction;
  /** `queue|jobId` (bulk: số job). */
  target: string;
  jobType: string | null;
  result: 'success' | 'failed';
  detail: string | null;
  reason: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}

/** Lệnh gửi worker qua pub/sub. */
export interface JobCommand {
  id: string;
  action: 'cancel';
  queue: string;
  jobId: string;
  reason: string;
  requestedAt: number;
}

export interface JobCommandResult {
  id: string;
  /** `accepted`: worker đang xử lý job đã nhận yêu cầu huỷ. */
  status: 'accepted';
  instance: string;
  at: number;
}
