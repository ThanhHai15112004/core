import type {
  ResolvedSettingView,
  SettingResolveContext,
  SettingValidationRules,
  SettingValueTypeCode,
  SettingValueTypeName,
} from '@packages/kernel/index.js';

export const SETTINGS_PUBLIC_SERVICE = Symbol('SETTINGS_PUBLIC_SERVICE');

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
