import type {
  InboundWebhookHandlerRegistration,
  ProcessQueuedInboundWebhookContext,
  ProcessQueuedInboundWebhookResult,
  QueuedInboundWebhookJobPayload,
  ReceiveInboundWebhookInput,
  ReceiveInboundWebhookResult,
} from '../types/inbound-webhooks.types.js';

export * from '../enum/inbound-webhooks.enum.js';
export * from '../types/inbound-webhooks.types.js';

export interface IInboundWebhooksPublicService {
  /** Tiếp nhận, xác minh chữ ký/token, kiểm tra timestamp + idempotency và đẩy Queue */
  receiveWebhook(input: ReceiveInboundWebhookInput): Promise<ReceiveInboundWebhookResult>;

  /** Xử lý job inbound webhook từ Queue Worker */
  processQueuedEvent(
    payload: QueuedInboundWebhookJobPayload,
    context?: ProcessQueuedInboundWebhookContext,
  ): Promise<ProcessQueuedInboundWebhookResult>;
}

export interface IInboundWebhookHandlerRegistry {
  registerHandler(registration: InboundWebhookHandlerRegistration): void;
  unregisterHandler(name: string): void;
  listHandlers(): readonly Omit<InboundWebhookHandlerRegistration, 'handle'>[];
}

export const INBOUND_WEBHOOKS_PUBLIC_SERVICE = Symbol('INBOUND_WEBHOOKS_PUBLIC_SERVICE');
export const INBOUND_WEBHOOK_HANDLER_REGISTRY = Symbol('INBOUND_WEBHOOK_HANDLER_REGISTRY');
