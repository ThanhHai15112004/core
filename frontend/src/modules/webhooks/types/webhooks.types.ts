export type WebhookEndpointStatusName = 'ACTIVE' | 'PAUSED' | 'AUTO_DISABLED';

export type WebhookDeliveryStatusName =
  | 'PENDING'
  | 'RETRYING'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

export type WebhookTriggerSource = 'EVENT' | 'MANUAL_REPLAY' | 'TEST';

export interface WebhookEventCatalogItem {
  readonly eventName: string;
  readonly module: string;
  readonly moduleDisplayName: string;
  readonly description: string;
}

export interface WebhookEndpointItem {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly url: string;
  readonly events: readonly string[];
  readonly status: number;
  readonly statusName: WebhookEndpointStatusName;
  readonly signingSecretPrefix: string;
  readonly customHeaders: Record<string, string>;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly failureThreshold: number;
  readonly consecutiveFailures: number;
  readonly disabledReason: string | null;
  readonly disabledAt: string | null;
  readonly lastTriggeredAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WebhookEndpointWithSecretItem extends WebhookEndpointItem {
  readonly signingSecret: string;
}

export interface WebhookDeliveryAttemptItem {
  readonly id: number;
  readonly deliveryId: number;
  readonly endpointId: number;
  readonly attemptNumber: number;
  readonly requestUrl: string;
  readonly requestHeaders: Record<string, string>;
  readonly responseStatus: number | null;
  readonly responseHeaders: Record<string, string>;
  readonly responseBodySnippet: string | null;
  readonly durationMs: number;
  readonly isSuccess: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly attemptedAt: string;
}

export interface WebhookDeliveryItem {
  readonly id: number;
  readonly deliveryUid: string;
  readonly endpointId: number;
  readonly endpointName?: string | null;
  readonly endpointUrl?: string | null;
  readonly eventName: string;
  readonly eventId: string;
  readonly payload: Record<string, unknown>;
  readonly status: number;
  readonly statusName: WebhookDeliveryStatusName;
  readonly triggerSource: WebhookTriggerSource;
  readonly replayedFromDeliveryId: number | null;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly lastHttpStatus: number | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly nextRetryAt: string | null;
  readonly deliveredAt: string | null;
  readonly correlationId: string | null;
  readonly requestedBy: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attempts?: readonly WebhookDeliveryAttemptItem[];
}
