import {
  ALL_PROVIDER_TYPES,
  SettingRegistryService,
  defaultSettingRegistry,
  normalizeProviderType,
  type ProviderTypeName,
} from '@packages/kernel/index.js';
import {
  PROVIDER_REGISTRY_DEFAULTS,
  PROVIDER_REGISTRY_SETTING_KEYS,
} from '../enum/provider-registry.enum.js';
import type { ProviderRegistryRuntimeConfig } from '../types/provider-registry.types.js';

function normalizeAllowedTypes(raw: unknown): ProviderTypeName[] {
  if (!Array.isArray(raw)) {
    return [...PROVIDER_REGISTRY_DEFAULTS.FALLBACK_ALLOWED_TYPES];
  }
  const out: ProviderTypeName[] = [];
  for (const item of raw) {
    const normalized = normalizeProviderType(item);
    if (normalized && !out.includes(normalized)) {
      out.push(normalized);
    }
  }
  return out;
}

export function resolveProviderRegistryConfig(
  settingRegistry: SettingRegistryService = defaultSettingRegistry,
): ProviderRegistryRuntimeConfig {
  const rawTypes = settingRegistry.getJson<unknown>(
    PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ALLOWED_TYPES,
    undefined,
    [...ALL_PROVIDER_TYPES],
  );

  return {
    fallbackEnabled: settingRegistry.getBoolean(
      PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ENABLED,
      undefined,
      PROVIDER_REGISTRY_DEFAULTS.FALLBACK_ENABLED,
    ),
    fallbackAllowedTypes: normalizeAllowedTypes(rawTypes),
    fallbackOnPaused: settingRegistry.getBoolean(
      PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ON_PAUSED,
      undefined,
      PROVIDER_REGISTRY_DEFAULTS.FALLBACK_ON_PAUSED,
    ),
    fallbackOnDown: settingRegistry.getBoolean(
      PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ON_DOWN,
      undefined,
      PROVIDER_REGISTRY_DEFAULTS.FALLBACK_ON_DOWN,
    ),
    fallbackOnDegraded: settingRegistry.getBoolean(
      PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ON_DEGRADED,
      undefined,
      PROVIDER_REGISTRY_DEFAULTS.FALLBACK_ON_DEGRADED,
    ),
    unitRoutingEnabled: settingRegistry.getBoolean(
      PROVIDER_REGISTRY_SETTING_KEYS.UNIT_ROUTING_ENABLED,
      undefined,
      PROVIDER_REGISTRY_DEFAULTS.UNIT_ROUTING_ENABLED,
    ),
    healthCheckTimeoutMs: Math.max(
      500,
      Math.min(
        30000,
        settingRegistry.getNumber(
          PROVIDER_REGISTRY_SETTING_KEYS.HEALTH_CHECK_TIMEOUT_MS,
          undefined,
          PROVIDER_REGISTRY_DEFAULTS.HEALTH_CHECK_TIMEOUT_MS,
        ),
      ),
    ),
    degradedLatencyMs: Math.max(
      100,
      Math.min(
        60000,
        settingRegistry.getNumber(
          PROVIDER_REGISTRY_SETTING_KEYS.DEGRADED_LATENCY_MS,
          undefined,
          PROVIDER_REGISTRY_DEFAULTS.DEGRADED_LATENCY_MS,
        ),
      ),
    ),
    degradedErrorRatePct: Math.max(
      0.1,
      Math.min(
        100,
        settingRegistry.getNumber(
          PROVIDER_REGISTRY_SETTING_KEYS.DEGRADED_ERROR_RATE_PCT,
          undefined,
          PROVIDER_REGISTRY_DEFAULTS.DEGRADED_ERROR_RATE_PCT,
        ),
      ),
    ),
    downErrorRatePct: Math.max(
      1,
      Math.min(
        100,
        settingRegistry.getNumber(
          PROVIDER_REGISTRY_SETTING_KEYS.DOWN_ERROR_RATE_PCT,
          undefined,
          PROVIDER_REGISTRY_DEFAULTS.DOWN_ERROR_RATE_PCT,
        ),
      ),
    ),
    consecutiveFailuresForDown: Math.max(
      1,
      Math.min(
        20,
        Math.trunc(
          settingRegistry.getNumber(
            PROVIDER_REGISTRY_SETTING_KEYS.CONSECUTIVE_FAILURES_FOR_DOWN,
            undefined,
            PROVIDER_REGISTRY_DEFAULTS.CONSECUTIVE_FAILURES_FOR_DOWN,
          ),
        ),
      ),
    ),
    allowPrivateHealthUrls: settingRegistry.getBoolean(
      PROVIDER_REGISTRY_SETTING_KEYS.ALLOW_PRIVATE_HEALTH_URLS,
      undefined,
      PROVIDER_REGISTRY_DEFAULTS.ALLOW_PRIVATE_HEALTH_URLS,
    ),
    telemetryWindowMinutes: Math.max(
      5,
      Math.min(
        1440,
        Math.trunc(
          settingRegistry.getNumber(
            PROVIDER_REGISTRY_SETTING_KEYS.TELEMETRY_WINDOW_MINUTES,
            undefined,
            PROVIDER_REGISTRY_DEFAULTS.TELEMETRY_WINDOW_MINUTES,
          ),
        ),
      ),
    ),
  };
}
