import type {
  RegisteredSettingDefinition,
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
import type { SettingHistoryRecord } from '../contracts/index.js';
import type { SettingGroupRepository } from '../repositories/setting-group.repository.js';
import type { SystemSettingHistoryRepository } from '../repositories/system-setting-history.repository.js';
import type { SystemSettingScopeRepository } from '../repositories/system-setting-scope.repository.js';
import type { SystemSettingRepository } from '../repositories/system-setting.repository.js';
import type {
  CreateSettingRequest,
  UpdateSettingValueRequest,
} from '../requests/settings.requests.js';

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
