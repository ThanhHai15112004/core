export const WEBHOOK_ENDPOINT_STATUS = {
  ACTIVE: 1,
  PAUSED: 2,
  AUTO_DISABLED: 3,
} as const;

export type WebhookEndpointStatusCode =
  (typeof WEBHOOK_ENDPOINT_STATUS)[keyof typeof WEBHOOK_ENDPOINT_STATUS];
export type WebhookEndpointStatusName = keyof typeof WEBHOOK_ENDPOINT_STATUS;

export const WEBHOOK_DELIVERY_STATUS = {
  PENDING: 1,
  RETRYING: 2,
  DELIVERED: 3,
  FAILED: 4,
  CANCELLED: 5,
} as const;

export type WebhookDeliveryStatusCode =
  (typeof WEBHOOK_DELIVERY_STATUS)[keyof typeof WEBHOOK_DELIVERY_STATUS];
export type WebhookDeliveryStatusName = keyof typeof WEBHOOK_DELIVERY_STATUS;

export const WEBHOOK_TRIGGER_SOURCE = {
  EVENT: 'EVENT',
  MANUAL_REPLAY: 'MANUAL_REPLAY',
  TEST: 'TEST',
} as const;

export type WebhookTriggerSource =
  (typeof WEBHOOK_TRIGGER_SOURCE)[keyof typeof WEBHOOK_TRIGGER_SOURCE];

export const WEBHOOKS_CODE_TYPES = {
  ENDPOINT_STATUS: 'webhooks.endpoint_status',
  DELIVERY_STATUS: 'webhooks.delivery_status',
} as const;

export const WEBHOOKS_SETTING_KEYS = {
  DEFAULT_TIMEOUT_MS: 'webhooks.default_timeout_ms',
  DEFAULT_MAX_RETRIES: 'webhooks.default_max_retries',
  RETRY_BASE_DELAY_MS: 'webhooks.retry_base_delay_ms',
  DEFAULT_FAILURE_THRESHOLD: 'webhooks.default_failure_threshold',
  MAX_RESPONSE_SNIPPET_LENGTH: 'webhooks.max_response_snippet_length',
  ALLOW_HTTP_IN_DEV: 'webhooks.allow_http_in_dev',
  ALERT_ADMIN_ROLES: 'webhooks.alert_admin_roles',
  ALERT_CHANNELS: 'webhooks.alert_channels',
} as const;

export const WEBHOOKS_QUEUE_TOPICS = {
  DELIVERY_SEND: 'webhooks.delivery.send',
} as const;

export const WEBHOOK_HEADERS = {
  ID: 'X-Webhook-Id',
  EVENT: 'X-Webhook-Event',
  TIMESTAMP: 'X-Webhook-Timestamp',
  SIGNATURE: 'X-Webhook-Signature',
  ATTEMPT: 'X-Webhook-Attempt',
  CORRELATION_ID: 'X-Correlation-Id',
} as const;

export const WEBHOOK_DEFAULTS = {
  TIMEOUT_MS: 10_000,
  MAX_RETRIES: 5,
  RETRY_BASE_DELAY_MS: 5_000,
  FAILURE_THRESHOLD: 10,
  MAX_RESPONSE_SNIPPET_LENGTH: 2_048,
  ALLOW_HTTP_IN_DEV: false,
  ALERT_ADMIN_ROLES: ['super_admin', 'admin'] as readonly string[],
  ALERT_CHANNELS: ['IN_APP', 'EMAIL'] as readonly string[],
  SIGNATURE_VERSION: 'v1',
  SIGNATURE_TOLERANCE_SEC: 300,
  USER_AGENT: 'CorePlatform-Webhook/1.0',
} as const;

export function getWebhookEndpointStatusName(status: number): WebhookEndpointStatusName {
  if (status === WEBHOOK_ENDPOINT_STATUS.PAUSED) return 'PAUSED';
  if (status === WEBHOOK_ENDPOINT_STATUS.AUTO_DISABLED) return 'AUTO_DISABLED';
  return 'ACTIVE';
}

export function getWebhookDeliveryStatusName(status: number): WebhookDeliveryStatusName {
  switch (status) {
    case WEBHOOK_DELIVERY_STATUS.RETRYING:
      return 'RETRYING';
    case WEBHOOK_DELIVERY_STATUS.DELIVERED:
      return 'DELIVERED';
    case WEBHOOK_DELIVERY_STATUS.FAILED:
      return 'FAILED';
    case WEBHOOK_DELIVERY_STATUS.CANCELLED:
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}
