import type { CreateDomainEventInput, DomainEvent } from './domain-event.contract.js';

/**
 * Hợp đồng chuẩn cho Transactional Outbox (Phase 11.2).
 * Đặt tại `@packages/kernel` để mọi module nghiệp vụ có thể ghi sự kiện vào Outbox
 * ngay trong cùng DB transaction nghiệp vụ mà không cần import chéo `OutboxModule`.
 */

export const OUTBOX_PUBLISHER_PORT = Symbol('OUTBOX_PUBLISHER_PORT');

export const OUTBOX_EVENT_STATUS = {
  /** Chờ Worker đọc và gửi ra Queue/Broker. */
  PENDING: 1,
  /** Đang được một Worker giữ lease xử lý (tránh gửi trùng). */
  PROCESSING: 2,
  /** Đã gửi thành công ra Queue/Broker. */
  PUBLISHED: 3,
  /** Gửi lỗi tạm thời, đang chờ tự động thử lại theo backoff. */
  FAILED: 4,
  /** Lỗi kéo dài vượt giới hạn retry hoặc lỗi vĩnh viễn — đưa vào Dead Letter để điều tra/phát lại. */
  DEAD_LETTER: 5,
} as const;

export type OutboxEventStatusCode = (typeof OUTBOX_EVENT_STATUS)[keyof typeof OUTBOX_EVENT_STATUS];

export type OutboxEventStatusName =
  | 'PENDING'
  | 'PROCESSING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'DEAD_LETTER';

export const OUTBOX_LAG_STATUS = {
  HEALTHY: 'HEALTHY',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
} as const;

export type OutboxLagStatus = (typeof OUTBOX_LAG_STATUS)[keyof typeof OUTBOX_LAG_STATUS];

export const OUTBOX_QUEUE_TOPICS = {
  DOMAIN_EVENT: 'outbox.domain_event',
  CLEANUP_TICK: 'outbox.cleanup.tick',
  LAG_ALERT_TICK: 'outbox.lag_alert.tick',
} as const;

export type OutboxQueueTopic = (typeof OUTBOX_QUEUE_TOPICS)[keyof typeof OUTBOX_QUEUE_TOPICS];

export const OUTBOX_DEFAULTS = {
  DESTINATION_QUEUE: 'system.events',
  DESTINATION_TOPIC: OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT,
  MAX_RETRIES: 5,
  MAX_RETRIES_CAP: 10,
  RETRY_BASE_DELAY_MS: 5_000,
  RETRY_MAX_DELAY_MS: 300_000,
  LEASE_TIMEOUT_MS: 60_000,
  POLL_INTERVAL_MS: 2_000,
  BATCH_SIZE: 50,
  LAG_WARN_COUNT: 100,
  LAG_CRIT_COUNT: 500,
  LAG_WARN_AGE_SEC: 60,
  LAG_CRIT_AGE_SEC: 300,
  DEAD_LETTER_WARN_COUNT: 1,
  RETENTION_PUBLISHED_DAYS: 7,
  RETENTION_DEAD_LETTER_DAYS: 30,
  CLEANUP_BATCH_SIZE: 1000,
} as const;

export interface EnqueueOutboxEventOptions {
  /** Hàng đợi đích trên Broker (mặc định `system.events`). */
  readonly destinationQueue?: string | undefined;
  /** Topic đích trên Broker (mặc định `outbox.domain_event`). */
  readonly destinationTopic?: string | undefined;
  /** Khóa phân vùng tùy chọn để bảo toàn thứ tự theo aggregate (mặc định `<aggregateType>:<aggregateId>`). */
  readonly partitionKey?: string | null | undefined;
  /** Số lần gửi lại tối đa cho sự kiện này (nếu bỏ trống lấy theo Setting `outbox.max_retries`). */
  readonly maxRetries?: number | undefined;
  /** Thời điểm sớm nhất Worker được phép gửi (mặc định ngay lập tức). */
  readonly availableAt?: Date | undefined;
  /** Header kỹ thuật bổ sung đính kèm khi đẩy ra Broker. */
  readonly headers?: Record<string, string> | undefined;
  /** Bắt buộc phải đang nằm trong transaction nghiệp vụ; ném lỗi nếu ngoài transaction. */
  readonly requireTransaction?: boolean | undefined;
}

export interface OutboxEnqueuedRecord {
  readonly id: number | null;
  readonly eventId: string;
  readonly eventType: string;
  readonly dotName: string;
  readonly status: OutboxEventStatusCode;
  readonly statusName: OutboxEventStatusName;
  readonly destinationQueue: string;
  readonly destinationTopic: string;
  readonly persisted: boolean;
}

export interface OutboxMetricsSnapshot {
  readonly pendingCount: number;
  readonly processingCount: number;
  readonly failedCount: number;
  readonly deadLetterCount: number;
  readonly publishedLast24hCount: number;
  readonly totalBacklogCount: number;
  readonly oldestPendingAgeSec: number | null;
  readonly avgPublishLagMs: number | null;
  readonly lagStatus: OutboxLagStatus;
  readonly alertReasons: readonly string[];
  readonly thresholds: {
    readonly lagWarnCount: number;
    readonly lagCritCount: number;
    readonly lagWarnAgeSec: number;
    readonly lagCritAgeSec: number;
    readonly deadLetterWarnCount: number;
  };
  readonly observedAt: string;
}

export type OutboxWriterDelegate = (
  event: DomainEvent,
  options?: EnqueueOutboxEventOptions,
) => Promise<OutboxEnqueuedRecord>;

export type OutboxMetricsProviderDelegate = () => Promise<OutboxMetricsSnapshot | null>;

export interface IOutboxPublisherPort {
  isReady(): boolean;
  enqueue<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    input: CreateDomainEventInput<TPayload> | DomainEvent<TPayload>,
    options?: EnqueueOutboxEventOptions,
  ): Promise<OutboxEnqueuedRecord>;
  getMetricsSnapshot(): Promise<OutboxMetricsSnapshot | null>;
}

export function getOutboxEventStatusName(status: number): OutboxEventStatusName {
  switch (status) {
    case OUTBOX_EVENT_STATUS.PROCESSING:
      return 'PROCESSING';
    case OUTBOX_EVENT_STATUS.PUBLISHED:
      return 'PUBLISHED';
    case OUTBOX_EVENT_STATUS.FAILED:
      return 'FAILED';
    case OUTBOX_EVENT_STATUS.DEAD_LETTER:
      return 'DEAD_LETTER';
    case OUTBOX_EVENT_STATUS.PENDING:
    default:
      return 'PENDING';
  }
}

export function parseOutboxEventStatus(raw: unknown): OutboxEventStatusCode | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw >= OUTBOX_EVENT_STATUS.PENDING && raw <= OUTBOX_EVENT_STATUS.DEAD_LETTER) {
      return raw as OutboxEventStatusCode;
    }
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toUpperCase();
    if (/^\d+$/.test(trimmed)) {
      return parseOutboxEventStatus(Number(trimmed));
    }
    switch (trimmed) {
      case 'PENDING':
        return OUTBOX_EVENT_STATUS.PENDING;
      case 'PROCESSING':
        return OUTBOX_EVENT_STATUS.PROCESSING;
      case 'PUBLISHED':
        return OUTBOX_EVENT_STATUS.PUBLISHED;
      case 'FAILED':
        return OUTBOX_EVENT_STATUS.FAILED;
      case 'DEAD_LETTER':
      case 'DEAD-LETTER':
      case 'DLQ':
        return OUTBOX_EVENT_STATUS.DEAD_LETTER;
      default:
        return null;
    }
  }
  return null;
}
