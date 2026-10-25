export type MessagingErrorKind =
  'processing' | 'timeout' | 'deserialize' | 'connection' | 'stalled';

/** Lỗi consume một message, dựng từ job lỗi của broker (failed / chờ retry) — không chứa payload. */
export interface MessagingErrorRecord {
  /** epoch ms — lần thử lỗi gần nhất. */
  at: number;
  kind: MessagingErrorKind;
  channel: string;
  queue: string;
  messageId: string;
  attempt: number;
  maxAttempts: number;
  /** Hết lượt thử → message nằm trong Dead Letter. */
  final: boolean;
  code: string | null;
  message: string;
  correlationId: string | null;
}

export type MessagingEventType =
  | 'connection_lost'
  | 'connection_recovered'
  | 'alert_started'
  | 'alert_recovered'
  | 'dead_lettered'
  | 'consumer_started'
  | 'consumer_stopped'
  | 'message_retried'
  | 'message_replayed'
  | 'message_discarded';

export interface MessagingEventRecord {
  id: string;
  at: number;
  type: MessagingEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  params: Record<string, string | number>;
  runtime: string | null;
}

export type MessagingOperationAction = 'retry' | 'replay' | 'discard' | 'payload' | 'test';

export interface MessagingOperationRecord {
  id: string;
  at: number;
  action: MessagingOperationAction;
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}

/** Một dòng vòng đời message (lưu bằng job log của BullMQ, JSON). */
export type LifecycleType =
  | 'received'
  | 'completed'
  | 'failed'
  | 'retry_scheduled'
  | 'dead_lettered'
  | 'retried_manually'
  | 'replayed'
  | 'cancel_requested'
  | 'cancelled'
  | 'stalled'
  | 'skipped';

export interface LifecycleEntry {
  at: number;
  type: LifecycleType;
  runtime: string | null;
  consumer: string | null;
  attempt: number | null;
  ms: number | null;
  error: string | null;
  /** retry_scheduled: độ trễ trước lần thử kế tiếp. */
  delayMs: number | null;
  /** Instance worker (`worker@host:pid`) — có từ bản ghi mới. */
  instance?: string | null;
  /** failed: loại lỗi đã phân loại, có retry được không, hệ phụ thuộc gây lỗi. */
  errorType?: string | null;
  retryable?: boolean | null;
  dependency?: string | null;
  /** Người thao tác (retry / huỷ thủ công). */
  actor?: string | null;
}

/** Một worker đang lắng nghe queue (đọc từ `getWorkers()` của broker). */
export interface ConsumerRegistration {
  /** Tên consumer (processor), vd. `SystemProcessor`. */
  consumer: string;
  queue: string;
  runtime: string | null;
  instance: string;
  concurrency: number;
  paused: boolean;
  /** Processor tự khai báo idempotent; null = không rõ. */
  idempotent: boolean | null;
  /** Processor hỗ trợ huỷ hợp tác (AbortSignal); bản ghi cũ không có. */
  cancellable?: boolean;
  /** epoch ms */
  startedAt: number;
}

export type MessagingConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

export interface MessagingConnectionStatus {
  state: MessagingConnectionState;
  since: string;
  lastSuccessAt: string | null;
  lastPingMs: number | null;
  lastError: string | null;
  /** Lần publish thành công gần nhất trong process này. */
  lastPublishAt: string | null;
  failures: number;
}
