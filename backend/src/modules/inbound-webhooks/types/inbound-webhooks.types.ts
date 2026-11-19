import type {
  InboundWebhookAuthType,
  InboundWebhookEventStatusCode,
  InboundWebhookEventStatusName,
  InboundWebhookProviderStatusCode,
  InboundWebhookProviderStatusName,
  InboundWebhookSignatureFormat,
} from '../enum/inbound-webhooks.enum.js';

export interface InboundWebhookProviderView {
  readonly id: number;
  readonly providerCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: InboundWebhookProviderStatusCode;
  readonly statusName: InboundWebhookProviderStatusName;
  readonly authType: InboundWebhookAuthType;
  readonly signingSecretPrefix: string;
  readonly signatureHeader: string;
  readonly signaturePrefix: string | null;
  readonly signatureFormat: InboundWebhookSignatureFormat;
  readonly timestampHeader: string;
  readonly requireTimestamp: boolean;
  readonly toleranceSec: number;
  readonly eventIdHeader: string;
  readonly eventIdPayloadPath: string | null;
  readonly eventTypeHeader: string;
  readonly eventTypePayloadPath: string | null;
  readonly sensitiveFields: readonly string[];
  readonly maxRetries: number;
  readonly receivePath: string;
  readonly lastReceivedAt: string | null;
  readonly lastProcessedAt: string | null;
  readonly lastRejectedAt: string | null;
  readonly createdBy: number | null;
  readonly updatedBy: number | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InboundWebhookProviderWithSecretView extends InboundWebhookProviderView {
  /** Plaintext secret chỉ trả 1 lần duy nhất lúc tạo mới hoặc xoay khóa */
  readonly signingSecret: string;
}

export interface InboundWebhookAttemptView {
  readonly id: number;
  readonly eventId: number;
  readonly providerId: number;
  readonly providerCode: string;
  readonly attemptNumber: number;
  readonly handlerName: string;
  readonly isSuccess: boolean;
  readonly durationMs: number;
  readonly resultSummary: Record<string, unknown> | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly attemptedAt: string;
}

export interface InboundWebhookEventView {
  readonly id: number;
  readonly eventUid: string;
  readonly providerId: number;
  readonly providerCode: string;
  readonly providerName?: string | null;
  readonly externalEventId: string | null;
  readonly eventType: string | null;
  readonly eventTimestamp: string | null;
  readonly payloadHash: string;
  readonly headers: Record<string, string>;
  readonly payload: Record<string, unknown>;
  readonly payloadSizeBytes: number;
  readonly payloadTruncated: boolean;
  readonly sourceIpMasked: string | null;
  readonly status: InboundWebhookEventStatusCode;
  readonly statusName: InboundWebhookEventStatusName;
  readonly rejectionReason: string | null;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly duplicateCount: number;
  readonly lastDuplicateAt: string | null;
  readonly lastHandlerName: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly receivedAt: string;
  readonly processedAt: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attempts?: readonly InboundWebhookAttemptView[];
}

export interface ReceiveInboundWebhookInput {
  readonly providerCode: string;
  readonly rawBody: string;
  readonly parsedBody: unknown;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly sourceIp?: string | undefined;
  readonly correlationId?: string | null | undefined;
}

export interface ReceiveInboundWebhookResult {
  readonly accepted: true;
  readonly duplicate: boolean;
  readonly eventId: number;
  readonly eventUid: string;
  readonly providerCode: string;
  readonly externalEventId: string;
  readonly eventType: string | null;
  readonly status: InboundWebhookEventStatusCode;
  readonly statusName: InboundWebhookEventStatusName;
}

export interface SimulateInboundWebhookResult {
  readonly receiveResult: ReceiveInboundWebhookResult;
  readonly generatedEventId: string;
  readonly signatureHeaderUsed: string;
}

export interface QueuedInboundWebhookJobPayload {
  readonly inboundEventId: number;
  readonly eventUid?: string | undefined;
  readonly providerCode?: string | undefined;
}

export interface ProcessQueuedInboundWebhookContext {
  readonly attemptNumber?: number | undefined;
  readonly maxAttempts?: number | undefined;
  readonly jobId?: string | undefined;
}

export interface ProcessQueuedInboundWebhookResult {
  readonly eventId: number;
  readonly providerCode: string;
  readonly status: InboundWebhookEventStatusName | 'SKIPPED';
  readonly handlerName: string;
  readonly attemptNumber: number;
  readonly skipped?: boolean;
  readonly reason?: string;
}

export interface InboundWebhookRuntimeConfig {
  readonly defaultToleranceSec: number;
  readonly defaultMaxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly maxStoredPayloadBytes: number;
  readonly recordRejectedRequests: boolean;
  readonly maskPiiInPayload: boolean;
}

export interface InboundWebhookHandlerContext {
  readonly eventId: number;
  readonly eventUid: string;
  readonly providerCode: string;
  readonly externalEventId: string;
  readonly eventType: string | null;
  readonly eventTimestamp: Date | null;
  readonly payload: Record<string, unknown>;
  readonly headers: Record<string, string>;
  readonly correlationId: string | null;
  readonly attemptNumber: number;
}

export interface InboundWebhookHandlerResult {
  readonly summary?: Record<string, unknown> | undefined;
}

export type InboundWebhookHandlerFn = (
  context: InboundWebhookHandlerContext,
) => Promise<InboundWebhookHandlerResult | void>;

export interface InboundWebhookHandlerRegistration {
  readonly name: string;
  readonly providerCode: string;
  readonly eventType: string;
  readonly handle: InboundWebhookHandlerFn;
}
