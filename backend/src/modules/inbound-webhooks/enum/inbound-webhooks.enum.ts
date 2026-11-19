export const INBOUND_WEBHOOK_PROVIDER_STATUS = {
  ACTIVE: 1,
  PAUSED: 2,
} as const;

export type InboundWebhookProviderStatusCode =
  (typeof INBOUND_WEBHOOK_PROVIDER_STATUS)[keyof typeof INBOUND_WEBHOOK_PROVIDER_STATUS];
export type InboundWebhookProviderStatusName = keyof typeof INBOUND_WEBHOOK_PROVIDER_STATUS;

export const INBOUND_WEBHOOK_EVENT_STATUS = {
  QUEUED: 1,
  PROCESSING: 2,
  PROCESSED: 3,
  FAILED: 4,
  REJECTED: 5,
} as const;

export type InboundWebhookEventStatusCode =
  (typeof INBOUND_WEBHOOK_EVENT_STATUS)[keyof typeof INBOUND_WEBHOOK_EVENT_STATUS];
export type InboundWebhookEventStatusName = keyof typeof INBOUND_WEBHOOK_EVENT_STATUS;

export const INBOUND_WEBHOOK_AUTH_TYPE = {
  HMAC_SHA256: 'HMAC_SHA256',
  HMAC_SHA512: 'HMAC_SHA512',
  STATIC_TOKEN: 'STATIC_TOKEN',
} as const;

export type InboundWebhookAuthType =
  (typeof INBOUND_WEBHOOK_AUTH_TYPE)[keyof typeof INBOUND_WEBHOOK_AUTH_TYPE];

export const INBOUND_WEBHOOK_SIGNATURE_FORMAT = {
  TIMESTAMP_DOT_BODY: 'TIMESTAMP_DOT_BODY',
  RAW_BODY: 'RAW_BODY',
} as const;

export type InboundWebhookSignatureFormat =
  (typeof INBOUND_WEBHOOK_SIGNATURE_FORMAT)[keyof typeof INBOUND_WEBHOOK_SIGNATURE_FORMAT];

export const INBOUND_WEBHOOK_REJECTION_REASON = {
  PROVIDER_PAUSED: 'PROVIDER_PAUSED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  INVALID_TOKEN: 'INVALID_TOKEN',
  MISSING_TIMESTAMP: 'MISSING_TIMESTAMP',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  TIMESTAMP_EXPIRED: 'TIMESTAMP_EXPIRED',
  MISSING_EVENT_ID: 'MISSING_EVENT_ID',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
} as const;

export type InboundWebhookRejectionReason =
  (typeof INBOUND_WEBHOOK_REJECTION_REASON)[keyof typeof INBOUND_WEBHOOK_REJECTION_REASON];

export const INBOUND_WEBHOOKS_CODE_TYPES = {
  PROVIDER_STATUS: 'inbound_webhooks.provider_status',
  EVENT_STATUS: 'inbound_webhooks.event_status',
} as const;

export const INBOUND_WEBHOOKS_SETTING_KEYS = {
  DEFAULT_TOLERANCE_SEC: 'inbound_webhooks.default_tolerance_sec',
  DEFAULT_MAX_RETRIES: 'inbound_webhooks.default_max_retries',
  RETRY_BASE_DELAY_MS: 'inbound_webhooks.retry_base_delay_ms',
  MAX_STORED_PAYLOAD_BYTES: 'inbound_webhooks.max_stored_payload_bytes',
  RECORD_REJECTED_REQUESTS: 'inbound_webhooks.record_rejected_requests',
  MASK_PII_IN_PAYLOAD: 'inbound_webhooks.mask_pii_in_payload',
} as const;

export const INBOUND_WEBHOOKS_QUEUE_TOPICS = {
  EVENT_PROCESS: 'inbound-webhooks.event.process',
} as const;

export const INBOUND_WEBHOOK_DEFAULTS = {
  TOLERANCE_SEC: 300,
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 5_000,
  MAX_STORED_PAYLOAD_BYTES: 65_536,
  RECORD_REJECTED_REQUESTS: true,
  MASK_PII_IN_PAYLOAD: false,
  SIGNATURE_HEADER: 'x-webhook-signature',
  SIGNATURE_PREFIX: 'v1=',
  TIMESTAMP_HEADER: 'x-webhook-timestamp',
  EVENT_ID_HEADER: 'x-webhook-id',
  EVENT_ID_PAYLOAD_PATH: 'id',
  EVENT_TYPE_HEADER: 'x-webhook-event',
  EVENT_TYPE_PAYLOAD_PATH: 'type',
  SECRET_PREFIX: 'whin_',
} as const;

export function getInboundWebhookProviderStatusName(
  status: number,
): InboundWebhookProviderStatusName {
  return status === INBOUND_WEBHOOK_PROVIDER_STATUS.PAUSED ? 'PAUSED' : 'ACTIVE';
}

export function getInboundWebhookEventStatusName(status: number): InboundWebhookEventStatusName {
  switch (status) {
    case INBOUND_WEBHOOK_EVENT_STATUS.PROCESSING:
      return 'PROCESSING';
    case INBOUND_WEBHOOK_EVENT_STATUS.PROCESSED:
      return 'PROCESSED';
    case INBOUND_WEBHOOK_EVENT_STATUS.FAILED:
      return 'FAILED';
    case INBOUND_WEBHOOK_EVENT_STATUS.REJECTED:
      return 'REJECTED';
    default:
      return 'QUEUED';
  }
}
