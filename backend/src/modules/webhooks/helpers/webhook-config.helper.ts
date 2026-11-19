import {
  SettingRegistryService,
  defaultSettingRegistry,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import { WEBHOOKS_SETTING_KEYS, WEBHOOK_DEFAULTS } from '../enum/webhooks.enum.js';
import type { WebhookRuntimeConfig } from '../types/webhooks.types.js';

function parseStringListSetting(raw: unknown, fallback: readonly string[]): string[] {
  if (Array.isArray(raw)) {
    const items = raw.map((item) => String(item).trim()).filter(Boolean);
    return items.length > 0 ? items : [...fallback];
  }
  if (typeof raw === 'string') {
    const parsed = safeJsonParseStringArray(raw);
    if (parsed.length > 0) return parsed;
  }
  return [...fallback];
}

export function resolveWebhookRuntimeConfig(
  registry: SettingRegistryService = defaultSettingRegistry,
): WebhookRuntimeConfig {
  const defaultTimeoutMs = registry.getNumber(
    WEBHOOKS_SETTING_KEYS.DEFAULT_TIMEOUT_MS,
    undefined,
    WEBHOOK_DEFAULTS.TIMEOUT_MS,
  );
  const defaultMaxRetries = registry.getNumber(
    WEBHOOKS_SETTING_KEYS.DEFAULT_MAX_RETRIES,
    undefined,
    WEBHOOK_DEFAULTS.MAX_RETRIES,
  );
  const retryBaseDelayMs = registry.getNumber(
    WEBHOOKS_SETTING_KEYS.RETRY_BASE_DELAY_MS,
    undefined,
    WEBHOOK_DEFAULTS.RETRY_BASE_DELAY_MS,
  );
  const defaultFailureThreshold = registry.getNumber(
    WEBHOOKS_SETTING_KEYS.DEFAULT_FAILURE_THRESHOLD,
    undefined,
    WEBHOOK_DEFAULTS.FAILURE_THRESHOLD,
  );
  const maxResponseSnippetLength = registry.getNumber(
    WEBHOOKS_SETTING_KEYS.MAX_RESPONSE_SNIPPET_LENGTH,
    undefined,
    WEBHOOK_DEFAULTS.MAX_RESPONSE_SNIPPET_LENGTH,
  );
  const allowHttpInDev = registry.getBoolean(
    WEBHOOKS_SETTING_KEYS.ALLOW_HTTP_IN_DEV,
    undefined,
    WEBHOOK_DEFAULTS.ALLOW_HTTP_IN_DEV,
  );
  const rawAdminRoles = registry.getJson<unknown>(
    WEBHOOKS_SETTING_KEYS.ALERT_ADMIN_ROLES,
    undefined,
    WEBHOOK_DEFAULTS.ALERT_ADMIN_ROLES,
  );
  const rawAlertChannels = registry.getJson<unknown>(
    WEBHOOKS_SETTING_KEYS.ALERT_CHANNELS,
    undefined,
    WEBHOOK_DEFAULTS.ALERT_CHANNELS,
  );

  return {
    defaultTimeoutMs: Math.max(1000, Math.min(60_000, Math.trunc(defaultTimeoutMs))),
    defaultMaxRetries: Math.max(0, Math.min(9, Math.trunc(defaultMaxRetries))),
    retryBaseDelayMs: Math.max(500, Math.min(300_000, Math.trunc(retryBaseDelayMs))),
    defaultFailureThreshold: Math.max(2, Math.min(100, Math.trunc(defaultFailureThreshold))),
    maxResponseSnippetLength: Math.max(256, Math.min(16_384, Math.trunc(maxResponseSnippetLength))),
    allowHttpInDev: Boolean(allowHttpInDev),
    alertAdminRoles: parseStringListSetting(rawAdminRoles, WEBHOOK_DEFAULTS.ALERT_ADMIN_ROLES),
    alertChannels: parseStringListSetting(rawAlertChannels, WEBHOOK_DEFAULTS.ALERT_CHANNELS),
  };
}
