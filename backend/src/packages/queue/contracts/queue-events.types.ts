export type QueueEventType =
  | 'queue_paused'
  | 'queue_resumed'
  | 'failed_retried'
  | 'queue_drained'
  | 'job_stalled'
  | 'alert_started'
  | 'alert_recovered';

export interface QueueEventRecord {
  id: string;
  /** epoch ms */
  at: number;
  type: QueueEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  params: Record<string, string | number>;
  runtime: string | null;
}

export type QueueOperationAction = 'pause' | 'resume' | 'retry_failed' | 'drain';

export interface QueueOperationRecord {
  id: string;
  at: number;
  action: QueueOperationAction;
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}
