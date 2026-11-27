import {
  FeatureFlagRegistryService,
  ForbiddenAppException,
  SettingRegistryService,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import {
  DATA_GOVERNANCE_FEATURE_FLAGS,
  DATA_GOVERNANCE_SETTING_KEYS,
} from '../enum/data-governance.enum.js';

export interface DataGovernanceRuntimeConfig {
  readonly moduleEnabled: boolean;
  readonly dsarEnabled: boolean;
  readonly consentEnabled: boolean;
  readonly legalHoldEnabled: boolean;
  readonly dsarSlaDays: number;
  readonly exportTtlMinutes: number;
  readonly erasureRequireApproval: boolean;
  readonly allowSelfApproval: boolean;
  readonly defaultRetentionDays: number;
}

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

export function resolveDataGovernanceRuntimeConfig(
  settingRegistry: SettingRegistryService = defaultSettingRegistry,
  featureFlagRegistry: FeatureFlagRegistryService = defaultFeatureFlagRegistry,
): DataGovernanceRuntimeConfig {
  return {
    moduleEnabled: isFlagEnabledOrDefault(
      featureFlagRegistry,
      DATA_GOVERNANCE_FEATURE_FLAGS.ENABLED,
      true,
    ),
    dsarEnabled: isFlagEnabledOrDefault(
      featureFlagRegistry,
      DATA_GOVERNANCE_FEATURE_FLAGS.DSAR_ENABLED,
      true,
    ),
    consentEnabled: isFlagEnabledOrDefault(
      featureFlagRegistry,
      DATA_GOVERNANCE_FEATURE_FLAGS.CONSENT_ENABLED,
      true,
    ),
    legalHoldEnabled: isFlagEnabledOrDefault(
      featureFlagRegistry,
      DATA_GOVERNANCE_FEATURE_FLAGS.LEGAL_HOLD_ENABLED,
      true,
    ),
    dsarSlaDays: Math.max(
      1,
      settingRegistry.getNumber(DATA_GOVERNANCE_SETTING_KEYS.DSAR_SLA_DAYS, undefined, 30),
    ),
    exportTtlMinutes: Math.max(
      5,
      settingRegistry.getNumber(
        DATA_GOVERNANCE_SETTING_KEYS.DSAR_EXPORT_TTL_MINUTES,
        undefined,
        1440,
      ),
    ),
    erasureRequireApproval: settingRegistry.getBoolean(
      DATA_GOVERNANCE_SETTING_KEYS.ERASURE_REQUIRE_APPROVAL,
      undefined,
      true,
    ),
    allowSelfApproval: settingRegistry.getBoolean(
      DATA_GOVERNANCE_SETTING_KEYS.ALLOW_SELF_APPROVAL,
      undefined,
      false,
    ),
    defaultRetentionDays: Math.max(
      0,
      settingRegistry.getNumber(
        DATA_GOVERNANCE_SETTING_KEYS.DEFAULT_RETENTION_DAYS,
        undefined,
        365,
      ),
    ),
  };
}

export function assertDataGovernanceEnabled(config: DataGovernanceRuntimeConfig): void {
  if (!config.moduleEnabled) {
    throw new ForbiddenAppException('data-governance.moduleDisabled');
  }
}
