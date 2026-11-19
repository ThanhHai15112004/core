import type {
  WebhookDeliveryStatusCode,
  WebhookDeliveryStatusName,
  WebhookEndpointStatusCode,
  WebhookEndpointStatusName,
  WebhookTriggerSource,
} from '../enum/webhooks.enum.js';

export interface WebhookEventCatalogItem {
  readonly eventName: string;
  readonly module: string;
  readonly moduleDisplayName: string;
  readonly description: string;
}

export interface WebhookEndpointView {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly url: string;
  readonly events: readonly string[];
  readonly status: WebhookEndpointStatusCode;
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
  readonly createdBy: number | null;
  readonly updatedBy: number | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WebhookEndpointWithSecretView extends WebhookEndpointView {
  /** Plaintext secret chỉ trả 1 lần duy nhất lúc tạo mới hoặc xoay khóa */
  readonly signingSecret: string;
}

export interface WebhookDeliveryAttemptView {
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

export interface WebhookDeliveryView {
  readonly id: number;
  readonly deliveryUid: string;
  readonly endpointId: number;
  readonly endpointName?: string | null;
  readonly endpointUrl?: string | null;
  readonly eventName: string;
  readonly eventId: string;
  readonly payload: Record<string, unknown>;
  readonly status: WebhookDeliveryStatusCode;
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
  readonly attempts?: readonly WebhookDeliveryAttemptView[];
}

export interface DispatchWebhookEventInput {
  readonly eventName: string;
  readonly eventId?: string | undefined;
  readonly payload: Record<string, unknown>;
  readonly correlationId?: string | null | undefined;
  readonly requestedBy?: number | null | undefined;
}

export interface DispatchWebhookEventResult {
  readonly eventName: string;
  readonly eventId: string;
  readonly matchedEndpointsCount: number;
  readonly queuedCount: number;
  readonly failedEnqueueCount: number;
  readonly deliveryIds: readonly number[];
}

export interface QueuedWebhookDeliveryJobPayload {
  readonly deliveryId: number;
}

export interface ProcessQueuedWebhookDeliveryContext {
  readonly attemptNumber?: number | undefined;
  readonly maxAttempts?: number | undefined;
  readonly jobId?: string | undefined;
}

export interface ProcessQueuedWebhookDeliveryResult {
  readonly deliveryId: number;
  readonly endpointId: number;
  readonly status: WebhookDeliveryStatusName | 'SKIPPED';
  readonly httpStatus: number | null;
  readonly attemptNumber: number;
  readonly skipped?: boolean;
  readonly reason?: string;
  readonly autoDisabled?: boolean;
}

export interface WebhookRuntimeConfig {
  readonly defaultTimeoutMs: number;
  readonly defaultMaxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly defaultFailureThreshold: number;
  readonly maxResponseSnippetLength: number;
  readonly allowHttpInDev: boolean;
  readonly alertAdminRoles: readonly string[];
  readonly alertChannels: readonly string[];
}
