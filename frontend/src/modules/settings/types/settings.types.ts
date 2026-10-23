export interface SettingValidationRules {
  min?: number;
  max?: number;
  integerOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enumOptions?: (string | number)[];
  allowEmpty?: boolean;
}

export interface SettingGroupSummary {
  id: number;
  code: string;
  module: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isSystem: boolean;
  status: number;
  statusName: 'ACTIVE' | 'INACTIVE';
  settingCount: number;
}

export interface SettingScopeOverrideSummary {
  id: number;
  settingId: number;
  settingKey: string;
  environmentCode: number;
  environment: string;
  organizationUnitId: number | null;
  scopeKey: string;
  value: unknown;
  isSensitive: boolean;
  isEncrypted: boolean;
  hasValue: boolean;
  updatedBy: number | null;
  reason: string | null;
  updatedAt: string;
}

export interface SystemSettingSummary {
  id: number;
  groupId: number;
  key: string;
  groupCode: string;
  module: string;
  namespace: string;
  name: string;
  description: string | null;
  valueType: number;
  valueTypeName: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'JSON';
  value: unknown;
  globalValue: unknown;
  defaultValue: unknown;
  validationRules: SettingValidationRules | null;
  isSensitive: boolean;
  isEncrypted: boolean;
  hasValue: boolean;
  allowUnitOverride: boolean;
  isSystem: boolean;
  sortOrder: number;
  status: number;
  statusName: 'ACTIVE' | 'INACTIVE';
  resolvedSource: string;
  resolvedEnvironment: string;
  resolvedOrganizationUnitId: number | null;
  scopeOverrides: SettingScopeOverrideSummary[];
  updatedBy: number | null;
  updatedAt: string;
}

export interface SettingHistoryRecord {
  id: number;
  settingId: number;
  settingKey: string;
  environmentCode: number;
  environment: string;
  organizationUnitId: number | null;
  valueType: number;
  valueTypeName: string;
  oldValue: unknown;
  newValue: unknown;
  actorUserId: number | null;
  actorIdentifier: string | null;
  reason: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface SyncSettingsResult {
  syncedModules: string[];
  totalGroups: number;
  totalSettings: number;
  totalEnvironmentOverrides: number;
}

export interface FeatureFlagSummary {
  id: number;
  key: string;
  module: string;
  isModuleInstalled: boolean;
  name: string;
  description: string;
  isEnabled: boolean;
  rolloutPercentage: number;
  targetUserIds: string[];
  targetRoles: string[];
  targetOrganizationUnitIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  isCurrentlyInWindow: boolean;
  isExpired: boolean;
  metadata: Record<string, unknown> | null;
  isSystem: boolean;
  status: number;
  statusName: 'ACTIVE' | 'ARCHIVED';
  updatedBy: number | null;
  updatedAt: string;
}

export interface FeatureFlagEvaluationResult {
  key: string;
  module: string;
  isEnabled: boolean;
  reason: string;
  rolloutPercentage: number;
  matchedRule: string;
  evaluatedAt: string;
}

export interface FeatureFlagHistoryRecord {
  id: number;
  flagId: number;
  flagKey: string;
  action: 'CREATE' | 'UPDATE' | 'TOGGLE' | 'ARCHIVE';
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown>;
  actorUserId: number | null;
  actorIdentifier: string | null;
  reason: string | null;
  createdAt: string;
}

export interface I18nLocaleSummary {
  id: number;
  code: string;
  bcp47Tag: string;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
  dateFormat: string;
  datetimeFormat: string;
  currencyCode: string;
  numberDecimalSeparator: string;
  numberGroupSeparator: string;
  isDefault: boolean;
  isSystem: boolean;
  sortOrder: number;
  status: number;
  statusName: 'ACTIVE' | 'INACTIVE';
  updatedAt: string;
}

export interface I18nTimezoneSummary {
  id: number;
  code: string;
  name: string;
  labels: Record<string, string>;
  utcOffset: string;
  utcOffsetMinutes: number;
  region: string;
  isDefault: boolean;
  isSystem: boolean;
  sortOrder: number;
  status: number;
  statusName: 'ACTIVE' | 'INACTIVE';
  updatedAt: string;
}

export interface I18nTranslationSummary {
  id: number;
  locale: string;
  namespace: string;
  key: string;
  value: string;
  description: string | null;
  isSystem: boolean;
  status: number;
  statusName: 'ACTIVE' | 'INACTIVE';
  updatedAt: string;
}

export interface SequenceCounterSnapshot {
  periodKey: string;
  organizationUnitId: string | null;
  currentValue: number;
  updatedAt: string;
}

export interface SequenceRuleSummary {
  id: number;
  key: string;
  module: string;
  name: string;
  description: string | null;
  prefix: string;
  suffix: string;
  separator: string;
  dateFormat: number;
  dateFormatName: string;
  templatePattern: string | null;
  resolvedTemplate: string;
  paddingLength: number;
  startValue: number;
  step: number;
  resetPolicy: number;
  resetPolicyName: string;
  scopeByUnit: boolean;
  timezone: string;
  samplePreview: string;
  currentPeriodKey: string;
  currentCounterValue: number;
  counters: SequenceCounterSnapshot[];
  isSystem: boolean;
  status: number;
  statusName: 'ACTIVE' | 'ARCHIVED';
  updatedAt: string;
}

export interface SequencePreviewResult {
  key: string;
  resolvedTemplate: string;
  periodKey: string;
  dateSegment: string;
  sampleCode: string;
  nextThreeSamples: string[];
}

export interface SequenceGeneratedResult {
  key: string;
  code: string;
  sequenceNumber: number;
  formattedSequence: string;
  periodKey: string;
  organizationUnitId: string | null;
  generatedAt: string;
}

export interface MenuSummary {
  id: number;
  code: string;
  module: string;
  name: string;
  status: number;
  statusName: 'ACTIVE' | 'INACTIVE';
  link: string | null;
  linkApi: string | null;
  type: number;
  typeName: 'GROUP' | 'ITEM' | 'EXTERNAL' | 'ACTION';
  parent: number | null;
  parentCode: string | null;
  level: number;
  key: string | null;
  numOrder: number;
  icon: string | null;
  position: 'SIDEBAR' | 'TOPBAR' | 'FOOTER' | 'SYSTEM_CONSOLE';
  updatedAt: string;
}

export interface MenuTreeNodeItem extends MenuSummary {
  children: MenuTreeNodeItem[];
}

export interface MenuTreeEvaluationResult {
  position: string | null;
  totalItems: number;
  cacheVersion: number;
  items: MenuTreeNodeItem[];
}

