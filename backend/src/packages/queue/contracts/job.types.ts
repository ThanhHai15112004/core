import type { JobSource, LifecycleEntry } from '@packages/messaging/index.js';

/**
 * Trạng thái job chuẩn hoá (trung lập với provider). `stalled` = đang active nhưng không còn heartbeat (khoá hết hạn);
 * `cancelled` = huỷ khi chờ (bản ghi Console giữ lại) hoặc huỷ hợp tác khi đang chạy.
 */
export type JobStatus =
  'waiting' | 'active' | 'completed' | 'failed' | 'retrying' | 'delayed' | 'stalled' | 'cancelled';

export const JOB_STATUSES: JobStatus[] = [
  'waiting',
  'active',
  'completed',
  'failed',
  'retrying',
  'delayed',
  'stalled',
  'cancelled',
];

/** Danh sách lưu trữ thật trên BullMQ. */
export type JobListState =
  'waiting' | 'prioritized' | 'active' | 'delayed' | 'completed' | 'failed';

export const JOB_LIST_STATES: JobListState[] = [
  'waiting',
  'prioritized',
  'active',
  'delayed',
  'completed',
  'failed',
];

/** Danh sách BullMQ cần đọc cho mỗi trạng thái chuẩn hoá. */
export const LIST_STATES_OF: Record<JobStatus, JobListState[]> = {
  waiting: ['waiting', 'prioritized'],
  active: ['active'],
  stalled: ['active'],
  completed: ['completed'],
  failed: ['failed'],
  cancelled: ['failed'],
  retrying: ['delayed'],
  delayed: ['delayed'],
};

/**
 * Khả năng của job provider — UI render theo capability (provider khác có thể không có progress, stalled, priority,
 * parent/child…).
 */
export type JobCapability =
  | 'progress'
  | 'stalled'
  | 'priority'
  | 'delayed'
  | 'lifecycle'
  | 'stacktrace'
  | 'result'
  | 'retry'
  | 'cancel'
  | 'remove'
  | 'children';

export type JobPriorityLevel = 'critical' | 'high' | 'normal' | 'low';

export interface JobProgressInfo {
  percent: number | null;
  processed: number | null;
  total: number | null;
  step: string | null;
  phases: { name: string; state: 'done' | 'active' | 'pending' | 'failed' }[];
}

export interface JobHeartbeat {
  /** Còn khoá (worker vẫn gia hạn)? */
  alive: boolean;
  /** epoch ms — lần gia hạn khoá gần nhất ước tính từ TTL còn lại. */
  lastAt: number | null;
}

/** Mô hình job vận hành (spec §56) — một job ở một thời điểm. */
export interface JobRecord {
  id: string;
  queue: string;
  /** Loại job (topic). */
  type: string;
  status: JobStatus;
  /** Danh sách BullMQ thật (`unknown` nếu không xác định). */
  state: JobListState | 'unknown' | 'removed';
  /** Priority BullMQ (0 = không đặt). */
  priority: number;
  priorityLevel: JobPriorityLevel;
  /** epoch ms */
  createdAt: number;
  /** Thời điểm được phép chạy (delayed / retrying). */
  availableAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** Tên worker trên broker (BullMQ `processedBy`). */
  worker: string | null;
  attempts: number;
  maxAttempts: number;
  progress: JobProgressInfo | null;
  source: JobSource;
  producer: string | null;
  correlationId: string | null;
  requestId: string | null;
  idempotencyKey: string | null;
  index: Record<string, string>;
  schema: string | null;
  payloadSize: number;
  error: string | null;
  errorType: string | null;
  /** false = lỗi không retry được; null = không rõ. */
  retryable: boolean | null;
  stalledCount: number;
  delayReason: 'retry' | 'repeat' | 'delay' | null;
  waitMs: number | null;
  durationMs: number | null;
  /** Chỉ job active: null = chưa kiểm tra. */
  heartbeat: JobHeartbeat | null;
  cancelledAt: number | null;
  cancelledBy: string | null;
  cancelReason: string | null;
}

export interface JobBackoff {
  type: string;
  delayMs: number;
}

/** Chi tiết thô của một job (tầng trên redact payload / kết quả trước khi trả ra ngoài). */
export interface JobDetailRaw {
  record: JobRecord;
  lifecycle: LifecycleEntry[];
  /** Dòng log job không phải vòng đời (handler tự ghi `job.log`). */
  logs: string[];
  stacktrace: string[];
  payload: unknown;
  returnValue: unknown;
  backoff: JobBackoff | null;
  removeOnComplete: string | null;
  removeOnFail: string | null;
  /** Envelope hỏng (không đọc được). */
  malformed: boolean;
}

/** Bản ghi job bị huỷ khi còn chờ (BullMQ đã xoá job). */
export interface CancelledJobRecord {
  record: JobRecord;
  cancelledAt: number;
  actor: string | null;
  reason: string | null;
}

export interface JobProvider {
  readonly capabilities: ReadonlySet<JobCapability>;
  queues(): string[];
  isKnown(queue: string): boolean;
  /** Một đoạn của một danh sách (đã chuẩn hoá). */
  list(
    queue: string,
    state: JobListState,
    start: number,
    count: number,
    asc: boolean,
  ): Promise<JobRecord[]>;
  count(queue: string, state: JobListState): Promise<number>;
  /** Job theo ID (một queue hoặc mọi queue). */
  get(id: string, queue?: string | null): Promise<JobRecord | null>;
  detail(id: string, queue?: string | null): Promise<JobDetailRaw | null>;
  retry(queue: string, id: string): Promise<void>;
  /** Xoá job chưa chạy (waiting / delayed); trả về false nếu job đã sang trạng thái khác. */
  removeQueued(queue: string, id: string): Promise<boolean>;
  remove(queue: string, id: string): Promise<void>;
  /** Ghi một dòng vòng đời (retry / huỷ thủ công). */
  log(
    queue: string,
    id: string,
    entry: Partial<LifecycleEntry> & { type: LifecycleEntry['type'] },
  ): Promise<void>;
}
