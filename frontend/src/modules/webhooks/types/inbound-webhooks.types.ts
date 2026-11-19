export type InboundWebhookProviderStatusName = 'ACTIVE' | 'PAUSED';

export type InboundWebhookEventStatusName =
  | 'QUEUED'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'FAILED'
  | 'REJECTED';

export type InboundWebhookAuthType = 'HMAC_SHA256' | 'HMAC_SHA512' | 'STATIC_TOKEN';

export type InboundWebhookSignatureFormat = 'TIMESTAMP_DOT_BODY' | 'RAW_BODY';

export interface InboundWebhookProviderItem {
  readonly id: number;
  readonly providerCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: number;
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
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InboundWebhookProviderWithSecretItem extends InboundWebhookProviderItem {
  readonly signingSecret: string;
}

export interface InboundWebhookAttemptItem {
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

export interface InboundWebhookEventItem {
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
  readonly status: number;
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
  readonly attempts?: readonly InboundWebhookAttemptItem[];
}

export interface SimulateInboundWebhookResponse {
  readonly receiveResult: {
    readonly accepted: true;
    readonly duplicate: boolean;
    readonly eventId: number;
    readonly eventUid: string;
    readonly providerCode: string;
    readonly externalEventId: string;
    readonly eventType: string | null;
    readonly status: number;
    readonly statusName: InboundWebhookEventStatusName;
  };
  readonly generatedEventId: string;
  readonly signatureHeaderUsed: string;
}
