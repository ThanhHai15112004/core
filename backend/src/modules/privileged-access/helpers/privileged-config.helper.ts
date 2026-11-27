import {
  FeatureFlagRegistryService,
  SettingRegistryService,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import {
  PRIVILEGED_DEFAULTS,
  PRIVILEGED_FEATURE_FLAGS,
  PRIVILEGED_SETTING_KEYS,
} from '../enum/privileged-access.enum.js';
import type { PrivilegedAccessRuntimeConfig } from '../types/privileged-access.types.js';

function isFlagEnabledOrDefault(
  registry: FeatureFlagRegistryService,
  flagKey: string,
  fallback = true,
): boolean {
  const evaluation = registry.evaluate(flagKey);
  if (evaluation.reason === 'FLAG_NOT_FOUND') {
    return fallback;
  }
  return evaluation.enabled;
}

/** Đọc cấu hình vận hành Privileged Access Management từ Settings & Feature Flags */
export function resolvePrivilegedAccessRuntimeConfig(
  settingRegistry: SettingRegistryService = defaultSettingRegistry,
  featureFlagRegistry: FeatureFlagRegistryService = defaultFeatureFlagRegistry,
): PrivilegedAccessRuntimeConfig {
  const enabled = isFlagEnabledOrDefault(
    featureFlagRegistry,
    PRIVILEGED_FEATURE_FLAGS.ENABLED,
    true,
  );
  const breakGlassEnabled = isFlagEnabledOrDefault(
    featureFlagRegistry,
    PRIVILEGED_FEATURE_FLAGS.BREAK_GLASS_ENABLED,
    true,
  );
  const periodicReviewEnabled = isFlagEnabledOrDefault(
    featureFlagRegistry,
    PRIVILEGED_FEATURE_FLAGS.PERIODIC_REVIEW_ENABLED,
    true,
  );

  const rawRoles = settingRegistry.getString(
    PRIVILEGED_SETTING_KEYS.ALERT_ROLE_CODES,
    undefined,
    JSON.stringify(PRIVILEGED_DEFAULTS.ALERT_ROLE_CODES),
  );
  const parsedRoles = safeJsonParseStringArray(rawRoles);
  const alertRoleCodes =
    parsedRoles.length > 0 ? parsedRoles : [...PRIVILEGED_DEFAULTS.ALERT_ROLE_CODES];

  return {
    enabled,
    breakGlassEnabled,
    periodicReviewEnabled,
    enforceStepUpMfa: settingRegistry.getBoolean(
      PRIVILEGED_SETTING_KEYS.ENFORCE_STEP_UP_MFA,
      undefined,
      PRIVILEGED_DEFAULTS.ENFORCE_STEP_UP_MFA,
    ),
    requireApprovalDefault: settingRegistry.getBoolean(
      PRIVILEGED_SETTING_KEYS.REQUIRE_APPROVAL_DEFAULT,
      undefined,
      PRIVILEGED_DEFAULTS.REQUIRE_APPROVAL_DEFAULT,
    ),
    maxGrantDurationMinutes: Math.max(
      5,
      settingRegistry.getNumber(
        PRIVILEGED_SETTING_KEYS.MAX_GRANT_DURATION_MINUTES,
        undefined,
        PRIVILEGED_DEFAULTS.MAX_GRANT_DURATION_MINUTES,
      ),
    ),
    breakGlassMaxMinutes: Math.max(
      5,
      settingRegistry.getNumber(
        PRIVILEGED_SETTING_KEYS.BREAK_GLASS_MAX_MINUTES,
        undefined,
        PRIVILEGED_DEFAULTS.BREAK_GLASS_MAX_MINUTES,
      ),
    ),
    alertRoleCodes,
    alertCooldownSeconds: Math.max(
      0,
      settingRegistry.getNumber(
        PRIVILEGED_SETTING_KEYS.ALERT_COOLDOWN_SECONDS,
        undefined,
        PRIVILEGED_DEFAULTS.ALERT_COOLDOWN_SECONDS,
      ),
    ),
    alertCreateIncidentForCritical: settingRegistry.getBoolean(
      PRIVILEGED_SETTING_KEYS.ALERT_CREATE_INCIDENT_FOR_CRITICAL,
      undefined,
      PRIVILEGED_DEFAULTS.ALERT_CREATE_INCIDENT_FOR_CRITICAL,
    ),
    reviewCycleDays: Math.max(
      7,
      settingRegistry.getNumber(
        PRIVILEGED_SETTING_KEYS.REVIEW_CYCLE_DAYS,
        undefined,
        PRIVILEGED_DEFAULTS.REVIEW_CYCLE_DAYS,
      ),
    ),
    reviewDueDays: Math.max(
      1,
      settingRegistry.getNumber(
        PRIVILEGED_SETTING_KEYS.REVIEW_DUE_DAYS,
        undefined,
        PRIVILEGED_DEFAULTS.REVIEW_DUE_DAYS,
      ),
    ),
    revokeSessionsOnGrantExpiry: settingRegistry.getBoolean(
      PRIVILEGED_SETTING_KEYS.REVOKE_SESSIONS_ON_GRANT_EXPIRY,
      undefined,
      PRIVILEGED_DEFAULTS.REVOKE_SESSIONS_ON_GRANT_EXPIRY,
    ),
  };
}
