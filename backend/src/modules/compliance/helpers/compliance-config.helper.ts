import {
  FeatureFlagRegistryService,
  ForbiddenAppException,
  SEQUENCE_DATE_FORMAT,
  SEQUENCE_RESET_POLICY,
  SEQUENCE_STATUS,
  SequenceRegistryService,
  SettingRegistryService,
  defaultFeatureFlagRegistry,
  defaultSequenceRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import {
  COMPLIANCE_FEATURE_FLAGS,
  COMPLIANCE_SEQUENCE_KEYS,
  COMPLIANCE_SETTING_KEYS,
} from '../enum/compliance.enum.js';

export interface ComplianceRuntimeConfig {
  readonly moduleEnabled: boolean;
  readonly controlsEnabled: boolean;
  readonly vendorsEnabled: boolean;
  readonly reportsEnabled: boolean;
  readonly reviewReminderDaysBefore: number;
  readonly contractExpiringDaysBefore: number;
  readonly evidenceExpiringDaysBefore: number;
  readonly reportFileTtlSeconds: number;
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

export function resolveComplianceRuntimeConfig(
  settingRegistry: SettingRegistryService = defaultSettingRegistry,
  featureFlagRegistry: FeatureFlagRegistryService = defaultFeatureFlagRegistry,
): ComplianceRuntimeConfig {
  return {
    moduleEnabled: isFlagEnabledOrDefault(
      featureFlagRegistry,
      COMPLIANCE_FEATURE_FLAGS.ENABLED,
      true,
    ),
    controlsEnabled: isFlagEnabledOrDefault(
      featureFlagRegistry,
      COMPLIANCE_FEATURE_FLAGS.CONTROLS_ENABLED,
      true,
    ),
    vendorsEnabled: isFlagEnabledOrDefault(
      featureFlagRegistry,
      COMPLIANCE_FEATURE_FLAGS.VENDORS_ENABLED,
      true,
    ),
    reportsEnabled: isFlagEnabledOrDefault(
      featureFlagRegistry,
      COMPLIANCE_FEATURE_FLAGS.REPORTS_ENABLED,
      true,
    ),
    reviewReminderDaysBefore: Math.max(
      1,
      settingRegistry.getNumber(COMPLIANCE_SETTING_KEYS.REVIEW_REMINDER_DAYS_BEFORE, undefined, 30),
    ),
    contractExpiringDaysBefore: Math.max(
      1,
      settingRegistry.getNumber(
        COMPLIANCE_SETTING_KEYS.CONTRACT_EXPIRING_DAYS_BEFORE,
        undefined,
        45,
      ),
    ),
    evidenceExpiringDaysBefore: Math.max(
      1,
      settingRegistry.getNumber(
        COMPLIANCE_SETTING_KEYS.EVIDENCE_EXPIRING_DAYS_BEFORE,
        undefined,
        30,
      ),
    ),
    reportFileTtlSeconds: Math.max(
      60,
      settingRegistry.getNumber(COMPLIANCE_SETTING_KEYS.REPORT_FILE_TTL_SECONDS, undefined, 3600),
    ),
  };
}

export function assertComplianceEnabled(config: ComplianceRuntimeConfig): void {
  if (!config.moduleEnabled) {
    throw new ForbiddenAppException('compliance.moduleDisabled');
  }
}

export function assertControlsEnabled(config: ComplianceRuntimeConfig): void {
  assertComplianceEnabled(config);
  if (!config.controlsEnabled) {
    throw new ForbiddenAppException('compliance.controlsDisabled');
  }
}

export function assertVendorsEnabled(config: ComplianceRuntimeConfig): void {
  assertComplianceEnabled(config);
  if (!config.vendorsEnabled) {
    throw new ForbiddenAppException('compliance.vendorsDisabled');
  }
}

export function assertReportsEnabled(config: ComplianceRuntimeConfig): void {
  assertComplianceEnabled(config);
  if (!config.reportsEnabled) {
    throw new ForbiddenAppException('compliance.reportsDisabled');
  }
}

function ensureSequenceRuleRegistered(
  sequenceRegistry: SequenceRegistryService,
  key: string,
  prefix: string,
): void {
  if (sequenceRegistry.getRule(key)) return;
  sequenceRegistry.registerRule(
    {
      key,
      module: 'compliance',
      name: prefix,
      description: null,
      prefix,
      suffix: '',
      separator: '-',
      dateFormat: SEQUENCE_DATE_FORMAT.YYYY,
      dateFormatName: 'YYYY',
      templatePattern: null,
      paddingLength: 4,
      startValue: 1,
      step: 1,
      resetPolicy: SEQUENCE_RESET_POLICY.YEARLY,
      resetPolicyName: 'YEARLY',
      scopeByUnit: false,
      timezone: 'Asia/Ho_Chi_Minh',
      isSystem: true,
      status: SEQUENCE_STATUS.ACTIVE,
    },
    { silent: true },
  );
}

export async function nextComplianceControlCode(
  sequenceRegistry: SequenceRegistryService = defaultSequenceRegistry,
): Promise<string> {
  ensureSequenceRuleRegistered(sequenceRegistry, COMPLIANCE_SEQUENCE_KEYS.CONTROL_CODE, 'CTRL');
  const generated = await sequenceRegistry.nextCode(COMPLIANCE_SEQUENCE_KEYS.CONTROL_CODE);
  return generated.code;
}

export async function nextComplianceVendorCode(
  sequenceRegistry: SequenceRegistryService = defaultSequenceRegistry,
): Promise<string> {
  ensureSequenceRuleRegistered(sequenceRegistry, COMPLIANCE_SEQUENCE_KEYS.VENDOR_CODE, 'VEND');
  const generated = await sequenceRegistry.nextCode(COMPLIANCE_SEQUENCE_KEYS.VENDOR_CODE);
  return generated.code;
}
