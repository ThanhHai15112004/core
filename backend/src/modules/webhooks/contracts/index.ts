import type {
  DispatchWebhookEventInput,
  DispatchWebhookEventResult,
  ProcessQueuedWebhookDeliveryContext,
  ProcessQueuedWebhookDeliveryResult,
  QueuedWebhookDeliveryJobPayload,
  WebhookEventCatalogItem,
} from '../types/webhooks.types.js';

export * from '../enum/webhooks.enum.js';
export * from '../types/webhooks.types.js';

export interface IWebhooksPublicService {
  /** Phát sự kiện ra các Webhook Endpoint đang ACTIVE khớp mẫu sự kiện (đẩy qua Queue `system.events`) */
  dispatchEvent(input: DispatchWebhookEventInput): Promise<DispatchWebhookEventResult>;

  /** Xử lý job gửi webhook từ Queue Worker */
  processQueuedDelivery(
    payload: QueuedWebhookDeliveryJobPayload,
    context?: ProcessQueuedWebhookDeliveryContext,
  ): Promise<ProcessQueuedWebhookDeliveryResult>;

  /** Liệt kê danh mục sự kiện hệ thống được thu thập từ module manifests */
  listEventCatalog(): WebhookEventCatalogItem[];
}

export const WEBHOOKS_PUBLIC_SERVICE = Symbol('WEBHOOKS_PUBLIC_SERVICE');
