import { Injectable, Logger, Optional } from '@nestjs/common';
import type { CreateDomainEventInput, DomainEvent } from '../contracts/domain-event.contract.js';
import {
  OUTBOX_DEFAULTS,
  OUTBOX_EVENT_STATUS,
  getOutboxEventStatusName,
  type EnqueueOutboxEventOptions,
  type IOutboxPublisherPort,
  type OutboxEnqueuedRecord,
  type OutboxMetricsProviderDelegate,
  type OutboxMetricsSnapshot,
  type OutboxWriterDelegate,
} from '../contracts/outbox.contract.js';
import { DomainEventBusService, defaultDomainEventBus } from './domain-event-bus.service.js';

/**
 * Outbox Publisher Port (`@packages/kernel`, Phase 11.2):
 * - Chuẩn hóa & kiểm định Domain Event (dùng chung quy chuẩn Phase 11.1 + ngữ cảnh request/correlation/actor).
 * - Ủy quyền ghi bền vững vào bảng `outbox_events` cho `OutboxModule` thông qua `registerWriter(...)`.
 * - Khi chưa có writer (ví dụ unit test cô lập không nạp `OutboxModule`): nếu `requireTransaction` không bật,
 *   trả về `persisted: false` để luồng gọi có thể chủ động quyết định fallback sang in-memory `DomainEventBus`.
 */
@Injectable()
export class OutboxPublisherService implements IOutboxPublisherPort {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private writer: OutboxWriterDelegate | null = null;
  private metricsProvider: OutboxMetricsProviderDelegate | null = null;

  constructor(
    @Optional()
    private readonly domainEventBus: DomainEventBusService = defaultDomainEventBus,
  ) {}

  /** Đăng ký hàm ghi Outbox bền vững (do `OutboxModule` gọi lúc bootstrap). */
  public registerWriter(writer: OutboxWriterDelegate): () => void {
    this.writer = writer;
    return () => {
      if (this.writer === writer) {
        this.writer = null;
      }
    };
  }

  /** Đăng ký bộ đọc metrics Outbox để các module giám sát (`messaging-ops`) đọc không phụ thuộc chéo. */
  public registerMetricsProvider(provider: OutboxMetricsProviderDelegate): () => void {
    this.metricsProvider = provider;
    return () => {
      if (this.metricsProvider === provider) {
        this.metricsProvider = null;
      }
    };
  }

  public isReady(): boolean {
    return this.writer !== null;
  }

  /**
   * Chuẩn hóa Domain Event (kiểm tra tên, chặn ORM entity/secret, gắn requestId/correlationId/actorId)
   * và ghi vào bảng Outbox trong cùng transaction hiện hành.
   */
  public async enqueue<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    input: CreateDomainEventInput<TPayload> | DomainEvent<TPayload>,
    options?: EnqueueOutboxEventOptions,
  ): Promise<OutboxEnqueuedRecord> {
    const event = this.domainEventBus.resolveEvent(input);
    const destinationQueue = options?.destinationQueue?.trim() || OUTBOX_DEFAULTS.DESTINATION_QUEUE;
    const destinationTopic = options?.destinationTopic?.trim() || OUTBOX_DEFAULTS.DESTINATION_TOPIC;

    if (!this.writer) {
      if (options?.requireTransaction) {
        throw new Error(
          `Outbox writer is not registered; cannot enqueue required transactional event "${event.type}" (${event.id})`,
        );
      }
      this.logger.debug(
        `Outbox writer not registered; skipping persistent write for "${event.type}" (${event.id})`,
      );
      return {
        id: null,
        eventId: event.id,
        eventType: event.type,
        dotName: event.metadata.dotName,
        status: OUTBOX_EVENT_STATUS.PENDING,
        statusName: getOutboxEventStatusName(OUTBOX_EVENT_STATUS.PENDING),
        destinationQueue,
        destinationTopic,
        persisted: false,
      };
    }

    return this.writer(event, {
      ...options,
      destinationQueue,
      destinationTopic,
    });
  }

  /** Lấy ảnh chụp độ trễ & tồn đọng Outbox (nếu `OutboxModule` đã đăng ký). */
  public async getMetricsSnapshot(): Promise<OutboxMetricsSnapshot | null> {
    if (!this.metricsProvider) {
      return null;
    }
    try {
      return await this.metricsProvider();
    } catch {
      return null;
    }
  }

  /** Đặt lại trạng thái nội bộ (chỉ dùng cho test). */
  public resetForTesting(): void {
    this.writer = null;
    this.metricsProvider = null;
  }
}

export const defaultOutboxPublisher = new OutboxPublisherService(defaultDomainEventBus);
