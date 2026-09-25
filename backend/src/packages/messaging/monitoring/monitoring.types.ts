import type { LifecycleEntry } from '../contracts/messaging-events.types.js';

/**
 * Khả năng của provider. UI hiện phần tương ứng theo capability, không hard-code theo broker:
 * BullMQ có queue depth, consumer, retry, dead letter, replay…; Kafka mới có partitions/consumer groups;
 * RabbitMQ mới có exchanges.
 */
export type MessagingCapability =
  | 'queueDepth'
  | 'consumers'
  | 'browse'
  | 'lifecycle'
  | 'retry'
  | 'deadLetter'
  | 'replay'
  | 'discard'
  | 'brokerInfo'
  | 'partitions'
  | 'consumerGroups'
  | 'exchanges';

/** Một phần số liệu: có dữ liệu, hoặc lý do không có. */
export type MessagingSection<T> =
  | { available: true; data: T }
  | { available: false; reason: 'unsupported' | 'disconnected' | 'error'; message: string | null };

/** Trạng thái message theo góc nhìn messaging (trung lập với broker). */
export type MessageStatus =
  'queued' | 'scheduled' | 'processing' | 'retrying' | 'delivered' | 'dead_letter' | 'unknown';

export const MESSAGE_STATUSES: MessageStatus[] = [
  'queued',
  'scheduled',
  'processing',
  'retrying',
  'delivered',
  'dead_letter',
];

export interface MessagingProviderInfo {
  driver: 'bullmq';
  /** Tên hiển thị: BullMQ. */
  product: string;
  /** Broker thật phía sau: Redis. */
  broker: string;
  /** host:port/db — không có mật khẩu. */
  endpoint: string;
  /** Tiền tố key của BullMQ. */
  prefix: string;
  /** Tên khái niệm "channel" trên broker này (để UI gọi đúng tên). */
  channelTerm: 'topic' | 'queue' | 'subject' | 'stream';
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  prioritized: number;
}

export interface BrokerWorker {
  name: string | null;
  addr: string | null;
  ageSec: number | null;
  idleSec: number | null;
}

export interface QueueSnapshot {
  name: string;
  counts: QueueCounts;
  paused: boolean;
  /** Kết nối worker đang lắng nghe queue (theo broker); null = broker không cho biết. */
  workers: BrokerWorker[] | null;
  /** epoch ms — message đang chờ lâu nhất. */
  oldestWaitingAt: number | null;
}

export interface ChannelBacklog {
  channel: string;
  queue: string;
  waiting: number;
  oldestAt: number | null;
}

export interface BacklogSample {
  channels: ChannelBacklog[];
  sampled: number;
  truncated: boolean;
}

export interface MessageSummary {
  id: string;
  queue: string;
  channel: string;
  status: MessageStatus;
  producer: string | null;
  correlationId: string | null;
  attempts: number;
  maxAttempts: number;
  /** epoch ms */
  publishedAt: number;
  processedAt: number | null;
  finishedAt: number | null;
  /** Lần thử kế tiếp (retry đang chờ / message hẹn giờ). */
  nextAttemptAt: number | null;
  durationMs: number | null;
  /** Thời gian chờ từ publish tới lần xử lý gần nhất. */
  waitMs: number | null;
  error: string | null;
  size: number;
}

export interface MessageDetail extends MessageSummary {
  /** Payload gốc — tầng trên phải redact trước khi trả ra ngoài. */
  payload: unknown;
  lifecycle: LifecycleEntry[];
  stacktrace: string[];
  backoff: { type: string; delayMs: number } | null;
  /** Message đã hỏng cấu trúc (không đọc được envelope). */
  malformed: boolean;
}

export interface MessageFilter {
  queue: string | null;
  channel: string | null;
  status: MessageStatus | null;
  producer: string | null;
  /** Message ID hoặc Correlation ID. */
  search: string;
}

export interface MessagePage {
  messages: MessageSummary[];
  /** Số message đã xét (giới hạn theo mỗi queue/trạng thái). */
  examined: number;
  truncated: boolean;
}

export interface BrokerInfo {
  version: string | null;
  uptimeSec: number | null;
  usedMemoryBytes: number | null;
  maxMemoryBytes: number | null;
  connectedClients: number | null;
  /** Kết nối BullMQ theo runtime (`core-<runtime>-bull`). */
  connections: { runtime: string; count: number }[];
}

export interface MessagingMonitoringProvider {
  readonly capabilities: ReadonlySet<MessagingCapability>;
  info(): MessagingProviderInfo;
  ping(): Promise<number>;
  queues(): Promise<QueueSnapshot[]>;
  backlog(limit: number): Promise<BacklogSample>;
  listMessages(filter: MessageFilter, perState: number): Promise<MessagePage>;
  message(id: string, queue?: string | null): Promise<MessageDetail | null>;
  retrying(limit: number): Promise<MessageSummary[]>;
  deadLetters(limit: number): Promise<MessageSummary[]>;
  /** Chạy lại ngay một message đang chờ retry (hoặc hẹn giờ). */
  retryNow(queue: string, id: string): Promise<void>;
  /** Đưa message từ Dead Letter về hàng đợi, đặt lại số lần thử. */
  replay(queue: string, id: string): Promise<void>;
  discard(queue: string, id: string): Promise<void>;
  broker(): Promise<BrokerInfo>;
}
