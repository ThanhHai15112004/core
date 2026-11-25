import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import {
  DOMAIN_EVENT_CRITICALITY,
  DomainEventBusService,
  defaultDomainEventBus,
  type DomainEvent,
} from '@packages/kernel/index.js';
import { WebhooksService } from '../services/webhooks.service.js';

export const WEBHOOKS_DOMAIN_EVENT_HANDLER_ID = 'webhooks.domain_event_bridge';

/**
 * Listener lắng nghe Domain Event từ mọi module nghiệp vụ khác và chuyển tiếp sang
 * `WebhooksService.dispatchEvent()` mà không cần module phát import chéo `WebhooksModule`.
 * - Chế độ `optional`: nếu gửi webhook gặp lỗi sẽ được ghi log cảnh báo, không làm hỏng nghiệp vụ chính.
 * - Bỏ qua các sự kiện do chính `webhooks` phát ra để tránh vòng lặp vô hạn.
 */
@Injectable()
export class WebhooksDomainEventListener implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly webhooksService: WebhooksService,
    @Optional()
    private readonly domainEventBus: DomainEventBusService = defaultDomainEventBus,
  ) {}

  public onModuleInit(): void {
    this.unsubscribe = this.domainEventBus.registerHandler({
      id: WEBHOOKS_DOMAIN_EVENT_HANDLER_ID,
      module: 'webhooks',
      eventPattern: '*',
      criticality: DOMAIN_EVENT_CRITICALITY.OPTIONAL,
      description: 'Forward system Domain Events to matching active outbound Webhook endpoints',
      handler: (event) => this.handleDomainEvent(event),
    });
  }

  public onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  public async handleDomainEvent(event: DomainEvent): Promise<void> {
    if (event.metadata.sourceModule === 'webhooks') {
      return;
    }

    const numericActor =
      typeof event.metadata.actorId === 'number'
        ? event.metadata.actorId
        : typeof event.metadata.actorId === 'string' && /^\d+$/.test(event.metadata.actorId)
          ? Number(event.metadata.actorId)
          : null;

    await this.webhooksService.dispatchEvent({
      eventName: event.metadata.dotName,
      eventId: event.id,
      payload: {
        ...event.payload,
        eventType: event.type,
        eventVersion: event.version,
        occurredAt: event.occurredAt,
        sourceModule: event.metadata.sourceModule,
        requestId: event.metadata.requestId,
      },
      correlationId: event.metadata.correlationId,
      requestedBy: numericActor,
    });
  }
}
