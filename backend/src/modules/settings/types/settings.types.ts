import type {
  FeatureFlagEvaluationContext,
  FeatureFlagEvaluationResult,
  FeatureFlagManifestItem,
  FeatureFlagRegistryService,
  MenuManifestItem,
  MenuRegistryService,
  RegisteredFeatureFlagDefinition,
  RegisteredMenuDefinition,
  RegisteredSequenceRuleDefinition,
  RegisteredSettingDefinition,
  SequenceManifestItem,
  SequenceRegistryService,
  SettingEnvironmentCode,
  SettingGroupManifestItem,
  SettingManifestItem,
  SettingRegistryService,
  SettingResolveContext,
  SettingValidationRules,
  SettingValueTypeCode,
} from '@packages/kernel/index.js';
import type {
  AuditLogService,
  FieldEncryptionService,
  UserIdentity,
} from '@packages/security/index.js';
import type {
  FeatureFlagHistoryRecord,
  SequenceRuleHistoryRecord,
  SettingHistoryRecord,
} from '../contracts/index.js';
import type { FeatureFlagHistoryRepository } from '../repositories/feature-flag-history.repository.js';
import type { FeatureFlagRepository } from '../repositories/feature-flag.repository.js';
import type { MenuRepository } from '../repositories/menu.repository.js';
import type { SequenceCounterRepository } from '../repositories/sequence-counter.repository.js';
import type { SequenceRuleHistoryRepository } from '../repositories/sequence-rule-history.repository.js';
import type { SequenceRuleRepository } from '../repositories/sequence-rule.repository.js';
import type { SettingGroupRepository } from '../repositories/setting-group.repository.js';
import type { SystemSettingHistoryRepository } from '../repositories/system-setting-history.repository.js';
import type { SystemSettingScopeRepository } from '../repositories/system-setting-scope.repository.js';
import type { SystemSettingRepository } from '../repositories/system-setting.repository.js';
import type {
  CreateSettingRequest,
  UpdateSettingValueRequest,
} from '../requests/settings.requests.js';
import type {
  FeatureFlagHistoryActionType,
  MenuAuditActionType,
  SequenceHistoryActionType,
} from '../enum/settings.enum.js';

export interface UpsertSettingGroupManifestParams {
  grp: SettingGroupManifestItem;
  groupRepository?: SettingGroupRepository | null | undefined;
  registry: SettingRegistryService;
}

export interface UpsertSettingDefinitionManifestParams {
  item: SettingManifestItem;
  settingRepository?: SystemSettingRepository | null | undefined;
  scopeRepository?: SystemSettingScopeRepository | null | undefined;
  registry: SettingRegistryService;
  encryptionService: FieldEncryptionService;
}

export interface HydrateSettingRegistryParams {
  groupRepository?: SettingGroupRepository | null | undefined;
  settingRepository?: SystemSettingRepository | null | undefined;
  scopeRepository?: SystemSettingScopeRepository | null | undefined;
  registry: SettingRegistryService;
  decryptIfNeeded: (raw: string, isEncrypted: boolean) => string;
  invalidateSettingCacheForKey: (settingKey: string) => Promise<void>;
  publishSettingChanged: (event: {
    key: string;
    module: string;
    namespace: string;
    environment: string;
    organizationUnitId: number | null;
    value: unknown;
  }) => Promise<void>;
}

export interface BuildSystemSettingSummaryParams {
  def: RegisteredSettingDefinition;
  context?: SettingResolveContext | undefined;
  fallbackId?: number | undefined;
  registry: SettingRegistryService;
  encryptionService: FieldEncryptionService;
  decryptIfNeeded: (raw: string, isEncrypted: boolean) => string;
}

export interface PersistAndAuditSettingHistoryParams {
  settingId: number;
  settingKey: string;
  environmentCode: SettingEnvironmentCode;
  environment: string;
  organizationUnitId: number | null;
  valueType: SettingValueTypeCode;
  oldSerializedValue: string | null;
  newSerializedValue: string;
  isSensitive: boolean;
  actor?: UserIdentity | null | undefined;
  reason?: string | null | undefined;
  action: string;
  nextHistoryId: () => number;
  historyRepository?: SystemSettingHistoryRepository | null | undefined;
  auditLogService?: AuditLogService | null | undefined;
  inMemoryHistory: SettingHistoryRecord[];
}

export interface BuildAndPersistNewSettingParams {
  dto: CreateSettingRequest;
  key: string;
  actorUserId: number | null;
  nextSettingId: () => number;
  registry: SettingRegistryService;
  encryptionService: FieldEncryptionService;
  settingRepository?: SystemSettingRepository | null | undefined;
}

export interface PersistGlobalSettingUpdateParams {
  def: RegisteredSettingDefinition;
  normKey: string;
  dto: UpdateSettingValueRequest;
  effectiveRules: SettingValidationRules | null;
  encryptedValue: string;
  isEncrypted: boolean;
  actorUserId: number | null;
  registry: SettingRegistryService;
  settingRepository?: SystemSettingRepository | null | undefined;
  decryptIfNeeded: (raw: string, isEncrypted: boolean) => string;
}

export interface PersistScopedSettingUpdateParams {
  def: RegisteredSettingDefinition;
  normKey: string;
  envCode: SettingEnvironmentCode;
  normEnv: string;
  unitId: number | null;
  encryptedValue: string;
  isEncrypted: boolean;
  actorUserId: number | null;
  reason: string | null;
  nextScopeId: () => number;
  registry: SettingRegistryService;
  scopeRepository?: SystemSettingScopeRepository | null | undefined;
  decryptIfNeeded: (raw: string, isEncrypted: boolean) => string;
}

export interface SyncManifestFeatureFlagsParams {
  customFlags?: readonly FeatureFlagManifestItem[] | undefined;
  registry: FeatureFlagRegistryService;
  flagRepository?: FeatureFlagRepository | null | undefined;
  upsertDefinitionSilent: (def: RegisteredFeatureFlagDefinition) => void;
  markHydrated: () => void;
}

export interface RecordFeatureFlagHistoryParams {
  flagId: number;
  flagKey: string;
  action: FeatureFlagHistoryActionType;
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown>;
  reason: string | null;
  actor?: UserIdentity | undefined;
  nextHistoryId: () => number;
  historyRepository?: FeatureFlagHistoryRepository | null | undefined;
  auditLogService?: AuditLogService | null | undefined;
  inMemoryHistory: FeatureFlagHistoryRecord[];
}

export interface SyncManifestSequencesParams {
  customSequences?: readonly SequenceManifestItem[] | undefined;
  registry: SequenceRegistryService;
  ruleRepository?: SequenceRuleRepository | null | undefined;
  counterRepository?: SequenceCounterRepository | null | undefined;
  nextRuleId: () => number;
  markHydrated: () => void;
}

export interface RecordSequenceHistoryParams {
  sequenceId: number;
  sequenceKey: string;
  action: SequenceHistoryActionType;
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown>;
  actor?: UserIdentity | undefined;
  reason?: string | null | undefined;
  nextHistoryId: () => number;
  historyRepository?: SequenceRuleHistoryRepository | null | undefined;
  auditLogService?: AuditLogService | null | undefined;
  inMemoryHistory: SequenceRuleHistoryRecord[];
}

export interface SyncManifestMenusParams {
  customMenus?: readonly MenuManifestItem[] | undefined;
  registry: MenuRegistryService;
  menuRepository?: MenuRepository | null | undefined;
  clearL2CacheSafe: () => Promise<void>;
  markHydrated: () => void;
}

export interface RecordMenuAuditParams {
  action: MenuAuditActionType;
  code: string;
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown>;
  actor?: UserIdentity | undefined;
  reason?: string | null | undefined;
  auditLogService?: AuditLogService | null | undefined;
}

export type {
  FeatureFlagEvaluationContext,
  FeatureFlagEvaluationResult,
  RegisteredMenuDefinition,
  RegisteredSequenceRuleDefinition,
};
