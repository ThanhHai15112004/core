import type {
  BuildAuthorizedMenuTreeOptions,
  FeatureFlagEvaluationContext,
  FeatureFlagEvaluationResult,
  MenuPositionCode,
  MenuStatusCode,
  MenuStatusName,
  MenuTreeEvaluationResult,
  MenuTypeCode,
  MenuTypeName,
  ResolvedSettingView,
  SequenceCounterSnapshot,
  SequenceDateFormatCode,
  SequenceDateFormatName,
  SequenceGenerateContext,
  SequenceGeneratedResult,
  SequencePreviewInput,
  SequencePreviewResult,
  SequenceResetPolicyCode,
  SequenceResetPolicyName,
  SettingResolveContext,
  SettingValidationRules,
  SettingValueTypeCode,
  SettingValueTypeName,
} from '@packages/kernel/index.js';

export const SETTINGS_PUBLIC_SERVICE = Symbol('SETTINGS_PUBLIC_SERVICE');
export const FEATURE_FLAGS_PUBLIC_SERVICE = Symbol('FEATURE_FLAGS_PUBLIC_SERVICE');
export const I18N_MANAGEMENT_PUBLIC_SERVICE = Symbol('I18N_MANAGEMENT_PUBLIC_SERVICE');
export const SEQUENCES_PUBLIC_SERVICE = Symbol('SEQUENCES_PUBLIC_SERVICE');
export const MENUS_PUBLIC_SERVICE = Symbol('MENUS_PUBLIC_SERVICE');

export interface SettingGroupSummary {
  readonly id: number;
  readonly code: string;
  readonly module: string;
  readonly name: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly sortOrder: number;
  readonly isSystem: boolean;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly settingCount: number;
}

export interface SettingScopeOverrideSummary {
  readonly id: number;
  readonly settingId: number;
  readonly settingKey: string;
  readonly environmentCode: number;
  readonly environment: string;
  readonly organizationUnitId: number | null;
  readonly scopeKey: string;
  readonly value: unknown;
  readonly isSensitive: boolean;
  readonly isEncrypted: boolean;
  readonly hasValue: boolean;
  readonly updatedBy: number | null;
  readonly reason: string | null;
  readonly updatedAt: string;
}

export interface SystemSettingSummary {
  readonly id: number;
  readonly groupId: number;
  readonly key: string;
  readonly groupCode: string;
  readonly module: string;
  readonly namespace: string;
  readonly name: string;
  readonly description: string | null;
  readonly valueType: SettingValueTypeCode;
  readonly valueTypeName: SettingValueTypeName;
  readonly value: unknown;
  readonly globalValue: unknown;
  readonly defaultValue: unknown;
  readonly validationRules: SettingValidationRules | null;
  readonly isSensitive: boolean;
  readonly isEncrypted: boolean;
  readonly hasValue: boolean;
  readonly allowUnitOverride: boolean;
  readonly isSystem: boolean;
  readonly sortOrder: number;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly resolvedSource: string;
  readonly resolvedEnvironment: string;
  readonly resolvedOrganizationUnitId: number | null;
  readonly scopeOverrides: readonly SettingScopeOverrideSummary[];
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface SettingHistoryRecord {
  readonly id: number;
  readonly settingId: number;
  readonly settingKey: string;
  readonly environmentCode: number;
  readonly environment: string;
  readonly organizationUnitId: number | null;
  readonly valueType: SettingValueTypeCode;
  readonly valueTypeName: SettingValueTypeName;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly actorUserId: number | null;
  readonly actorIdentifier: string | null;
  readonly reason: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

export interface SyncSettingsResult {
  readonly syncedModules: string[];
  readonly totalGroups: number;
  readonly totalSettings: number;
  readonly totalEnvironmentOverrides: number;
}

export interface ISettingsPublicService {
  syncManifests(): Promise<SyncSettingsResult>;
  resolve<T = unknown>(
    key: string,
    context?: SettingResolveContext,
  ): Promise<ResolvedSettingView<T>>;
  getDecryptedValue<T = unknown>(key: string, context?: SettingResolveContext): Promise<T>;
}

export interface FeatureFlagSummary {
  readonly id: number;
  readonly key: string;
  readonly module: string;
  readonly isModuleInstalled: boolean;
  readonly name: string;
  readonly description: string;
  readonly isEnabled: boolean;
  readonly rolloutPercentage: number;
  readonly targetUserIds: readonly string[];
  readonly targetRoles: readonly string[];
  readonly targetOrganizationUnitIds: readonly string[];
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly isCurrentlyInWindow: boolean;
  readonly isExpired: boolean;
  readonly metadata: Record<string, unknown> | null;
  readonly isSystem: boolean;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'ARCHIVED';
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface FeatureFlagHistoryRecord {
  readonly id: number;
  readonly flagId: number;
  readonly flagKey: string;
  readonly action: 'CREATE' | 'UPDATE' | 'TOGGLE' | 'ARCHIVE';
  readonly oldState: Record<string, unknown> | null;
  readonly newState: Record<string, unknown>;
  readonly actorUserId: number | null;
  readonly actorIdentifier: string | null;
  readonly reason: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

export interface SyncFeatureFlagsResult {
  readonly syncedModules: string[];
  readonly totalFlags: number;
}

export interface IFeatureFlagsPublicService {
  syncManifests(): Promise<SyncFeatureFlagsResult>;
  evaluate(
    key: string,
    context?: FeatureFlagEvaluationContext,
  ): Promise<FeatureFlagEvaluationResult>;
  isEnabled(key: string, context?: FeatureFlagEvaluationContext): Promise<boolean>;
}

export interface I18nLocaleSummary {
  readonly id: number;
  readonly code: string;
  readonly bcp47Tag: string;
  readonly name: string;
  readonly nativeName: string;
  readonly direction: 'ltr' | 'rtl';
  readonly dateFormat: string;
  readonly datetimeFormat: string;
  readonly currencyCode: string;
  readonly numberDecimalSeparator: string;
  readonly numberGroupSeparator: string;
  readonly isDefault: boolean;
  readonly isSystem: boolean;
  readonly sortOrder: number;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface I18nTimezoneSummary {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly labels: Record<string, string>;
  readonly utcOffset: string;
  readonly utcOffsetMinutes: number;
  readonly region: string;
  readonly isDefault: boolean;
  readonly isSystem: boolean;
  readonly sortOrder: number;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface I18nTranslationSummary {
  readonly id: number;
  readonly locale: string;
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface SyncI18nResult {
  readonly totalLocales: number;
  readonly totalTimezones: number;
  readonly totalTranslations: number;
}

export interface II18nManagementPublicService {
  syncDatabaseCatalog(): Promise<SyncI18nResult>;
  listLocales(query?: { status?: number }): Promise<I18nLocaleSummary[]>;
  listTimezones(query?: {
    status?: number;
    region?: string;
    q?: string;
  }): Promise<I18nTimezoneSummary[]>;
  listTranslations(query?: {
    locale?: string;
    namespace?: string;
    status?: number;
    q?: string;
  }): Promise<I18nTranslationSummary[]>;
}

export interface SequenceRuleSummary {
  readonly id: number;
  readonly key: string;
  readonly module: string;
  readonly name: string;
  readonly description: string | null;
  readonly prefix: string;
  readonly suffix: string;
  readonly separator: string;
  readonly dateFormat: SequenceDateFormatCode;
  readonly dateFormatName: SequenceDateFormatName;
  readonly templatePattern: string | null;
  readonly resolvedTemplate: string;
  readonly paddingLength: number;
  readonly startValue: number;
  readonly step: number;
  readonly resetPolicy: SequenceResetPolicyCode;
  readonly resetPolicyName: SequenceResetPolicyName;
  readonly scopeByUnit: boolean;
  readonly timezone: string;
  readonly samplePreview: string;
  readonly currentPeriodKey: string;
  readonly currentCounterValue: number;
  readonly counters: readonly SequenceCounterSnapshot[];
  readonly isSystem: boolean;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'ARCHIVED';
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface SequenceRuleHistoryRecord {
  readonly id: number;
  readonly sequenceId: number;
  readonly sequenceKey: string;
  readonly action: 'CREATE' | 'UPDATE' | 'RESET_COUNTER' | 'ARCHIVE';
  readonly oldState: Record<string, unknown> | null;
  readonly newState: Record<string, unknown>;
  readonly actorUserId: number | null;
  readonly actorIdentifier: string | null;
  readonly reason: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

export interface SyncSequencesResult {
  readonly syncedModules: string[];
  readonly totalSequences: number;
}

export interface ISequencesPublicService {
  syncManifests(): Promise<SyncSequencesResult>;
  preview(input: SequencePreviewInput): SequencePreviewResult;
  nextCode(key: string, context?: SequenceGenerateContext): Promise<SequenceGeneratedResult>;
  nextBatch(
    key: string,
    count: number,
    context?: SequenceGenerateContext,
  ): Promise<SequenceGeneratedResult[]>;
}

export interface MenuSummary {
  readonly id: number;
  readonly code: string;
  readonly module: string;
  readonly name: string;
  readonly status: MenuStatusCode;
  readonly statusName: MenuStatusName;
  readonly link: string | null;
  readonly linkApi: string | null;
  readonly type: MenuTypeCode;
  readonly typeName: MenuTypeName;
  readonly parent: number | null;
  readonly parentCode: string | null;
  readonly level: number;
  readonly key: string | null;
  readonly numOrder: number;
  readonly icon: string | null;
  readonly position: MenuPositionCode;
  readonly updatedAt: string;
}

export interface SyncMenusResult {
  readonly syncedModules: string[];
  readonly totalMenus: number;
}

export interface DeleteMenuResult {
  readonly deleted: true;
  readonly code: string;
  readonly id: number;
}

export interface InvalidateMenuCacheResult {
  readonly invalidated: true;
  readonly cacheVersion: number;
}

export interface IMenusPublicService {
  syncManifests(): Promise<SyncMenusResult>;
  getAuthorizedMenuTree(
    options?: BuildAuthorizedMenuTreeOptions,
  ): Promise<MenuTreeEvaluationResult>;
  invalidateCache(): Promise<InvalidateMenuCacheResult>;
}
