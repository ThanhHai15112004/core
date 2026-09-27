/**
 * Khả năng của queue provider. UI hiện phần tương ứng theo capability, không hard-code theo BullMQ:
 * provider khác (RabbitMQ, SQS…) có thể không có delayed / priority / drain…
 */
export type QueueCapability =
  'workers' | 'jobs' | 'delayed' | 'priority' | 'stalled' | 'pause' | 'retryFailed' | 'drain';

/** Một phần số liệu: có dữ liệu, hoặc lý do không có. */
export type QueueSection<T> =
  | { available: true; data: T }
  | { available: false; reason: 'unsupported' | 'disconnected' | 'error'; message: string | null };

/** Trạng thái job chuẩn hoá (trung lập với provider). */
export type JobState =
  'waiting' | 'prioritized' | 'active' | 'delayed' | 'retrying' | 'completed' | 'failed';

export const JOB_STATES: JobState[] = [
  'waiting',
  'prioritized',
  'active',
  'delayed',
  'retrying',
  'completed',
  'failed',
];

export interface QueueProviderInfo {
  driver: 'bullmq';
  product: string;
  /** Hệ lưu trữ phía sau (Redis). */
  backend: string;
  /** host:port/db — không có mật khẩu. */
  endpoint: string;
  prefix: string;
}

export interface QueueCounts {
  waiting: number;
  prioritized: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

export interface QueueWorkerConnection {
  /** Tên worker (= runtime), vd. `worker`. */
  name: string | null;
  addr: string | null;
  ageSec: number | null;
  idleSec: number | null;
}

export interface QueueInfo {
  name: string;
  counts: QueueCounts;
  paused: boolean;
  /** Kết nối worker đang lắng nghe queue; null = provider không cho biết. */
  workers: QueueWorkerConnection[] | null;
  /** epoch ms — job chờ lâu nhất. */
  oldestWaitingAt: number | null;
  /** id job chờ lâu nhất (mở thẳng được). */
  oldestWaitingId: string | null;
}

export interface JobSummary {
  id: string;
  queue: string;
  /** Loại job (tên job / topic). */
  name: string;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  priority: number;
  /** epoch ms */
  createdAt: number;
  processedAt: number | null;
  finishedAt: number | null;
  /** delayed / retrying: thời điểm chạy. */
  runAt: number | null;
  durationMs: number | null;
  waitMs: number | null;
  error: string | null;
  correlationId: string | null;
}

/** Option mặc định khi tạo job (retry, backoff, retention). */
export interface QueueJobDefaults {
  attempts: number;
  backoff: { type: string; delayMs: number } | null;
  removeOnComplete: string | null;
  removeOnFail: string | null;
}

export interface QueueMonitoringProvider {
  readonly capabilities: ReadonlySet<QueueCapability>;
  info(): QueueProviderInfo;
  ping(): Promise<number>;
  queues(): Promise<QueueInfo[]>;
  isKnown(queue: string): boolean;
  /** Job theo trạng thái (mỗi trạng thái tối đa `limit`), mới nhất trước. */
  jobs(queue: string | null, states: JobState[], limit: number): Promise<JobSummary[]>;
  defaults(): QueueJobDefaults;
  pause(queue: string): Promise<void>;
  resume(queue: string): Promise<void>;
  /** Đưa tối đa `count` job lỗi (cũ nhất trước) về hàng đợi. Trả về số job đã retry. */
  retryFailed(queue: string, count: number): Promise<number>;
  /** Xoá job đang chờ (và delayed nếu chọn); job đang chạy không bị ảnh hưởng. */
  drain(queue: string, includeDelayed: boolean): Promise<void>;
}
