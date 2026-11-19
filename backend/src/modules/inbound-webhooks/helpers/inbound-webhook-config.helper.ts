import { SettingRegistryService, defaultSettingRegistry } from '@packages/kernel/index.js';
import {
  INBOUND_WEBHOOKS_SETTING_KEYS,
  INBOUND_WEBHOOK_DEFAULTS,
} from '../enum/inbound-webhooks.enum.js';
import type { InboundWebhookRuntimeConfig } from '../types/inbound-webhooks.types.js';

export function resolveInboundWebhookRuntimeConfig(
  registry: SettingRegistryService = defaultSettingRegistry,
): InboundWebhookRuntimeConfig {
  const defaultToleranceSec = registry.getNumber(
    INBOUND_WEBHOOKS_SETTING_KEYS.DEFAULT_TOLERANCE_SEC,
    undefined,
    INBOUND_WEBHOOK_DEFAULTS.TOLERANCE_SEC,
  );
  const defaultMaxRetries = registry.getNumber(
    INBOUND_WEBHOOKS_SETTING_KEYS.DEFAULT_MAX_RETRIES,
    undefined,
    INBOUND_WEBHOOK_DEFAULTS.MAX_RETRIES,
  );
  const retryBaseDelayMs = registry.getNumber(
    INBOUND_WEBHOOKS_SETTING_KEYS.RETRY_BASE_DELAY_MS,
    undefined,
    INBOUND_WEBHOOK_DEFAULTS.RETRY_BASE_DELAY_MS,
  );
  const maxStoredPayloadBytes = registry.getNumber(
    INBOUND_WEBHOOKS_SETTING_KEYS.MAX_STORED_PAYLOAD_BYTES,
    undefined,
    INBOUND_WEBHOOK_DEFAULTS.MAX_STORED_PAYLOAD_BYTES,
  );
  const recordRejectedRequests = registry.getBoolean(
    INBOUND_WEBHOOKS_SETTING_KEYS.RECORD_REJECTED_REQUESTS,
    undefined,
    INBOUND_WEBHOOK_DEFAULTS.RECORD_REJECTED_REQUESTS,
  );
  const maskPiiInPayload = registry.getBoolean(
    INBOUND_WEBHOOKS_SETTING_KEYS.MASK_PII_IN_PAYLOAD,
    undefined,
    INBOUND_WEBHOOK_DEFAULTS.MASK_PII_IN_PAYLOAD,
  );

  return {
    defaultToleranceSec: Math.max(10, Math.min(86_400, Math.trunc(defaultToleranceSec))),
    defaultMaxRetries: Math.max(0, Math.min(9, Math.trunc(defaultMaxRetries))),
    retryBaseDelayMs: Math.max(500, Math.min(300_000, Math.trunc(retryBaseDelayMs))),
    maxStoredPayloadBytes: Math.max(1024, Math.min(1_048_576, Math.trunc(maxStoredPayloadBytes))),
    recordRejectedRequests: Boolean(recordRejectedRequests),
    maskPiiInPayload: Boolean(maskPiiInPayload),
  };
}
