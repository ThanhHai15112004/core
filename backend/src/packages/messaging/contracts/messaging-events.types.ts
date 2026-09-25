export type MessagingErrorKind =
  'processing' | 'timeout' | 'deserialize' | 'publish' | 'connection' | 'stalled' | 'other';

/** Lỗi publish/consume một message — không chứa payload. */
export interface MessagingErrorRecord {
  /** epoch ms */
  at: number;
  stage: 'publish' | 'consume';
  kind: MessagingErrorKind;
  channel: string;
  queue: string;
  messageId: string | null;
  /** Consumer (tên processor) hoặc null khi lỗi ở phía publish. */
  consumer: string | null;
  runtime: string | null;
  attempt: number | null;
  maxAttempts: number | null;
  /** Lần thử cuối → message vào Dead Letter. */
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
  | 'replayed';

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
}

/** Một consumer đang chạy trong một runtime (mỗi runtime tự báo lên Redis, có TTL). */
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
  /** epoch ms */
  startedAt: number;
  /** Message đang xử lý trong instance này. */
  inFlight: number;
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
