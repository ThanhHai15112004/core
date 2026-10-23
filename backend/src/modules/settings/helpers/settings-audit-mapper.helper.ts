import {
  type RegisteredSettingDefinition,
  SENSITIVE_SETTING_MASK,
  SETTING_ITEM_STATUS,
  type SettingRegistryService,
  type SettingValidationRules,
  type SettingValueTypeCode,
  buildSettingScopeKey,
  deserializeSettingValue,
  getSettingEnvironmentName,
  getSettingValueTypeName,
  parseSettingEnvironmentCode,
  parseSettingValueTypeCode,
  validateAndSerializeSettingValue,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  SettingHistoryRecord,
  SettingScopeOverrideSummary,
  SystemSettingSummary,
} from '../contracts/index.js';
import type { SystemSettingHistoryEntity } from '../entities/system-setting-history.entity.js';
import type { SystemSettingScopeEntity } from '../entities/system-setting-scope.entity.js';
import type { SystemSettingEntity } from '../entities/system-setting.entity.js';
import { MAX_IN_MEMORY_SETTING_HISTORY, SETTINGS_AUDIT_META } from '../enum/settings.enum.js';
import type {
  BuildAndPersistNewSettingParams,
  BuildSystemSettingSummaryParams,
  PersistAndAuditSettingHistoryParams,
  PersistGlobalSettingUpdateParams,
  PersistScopedSettingUpdateParams,
} from '../types/settings.types.js';

export function formatMaskedOrDeserializedSettingValue(params: {
  serialized: string | null | undefined;
  valueType: SettingValueTypeCode;
  isSensitive: boolean;
  isEncrypted: boolean;
  decryptIfNeeded: (raw: string, isEncrypted: boolean) => string;
}): unknown {
  const { serialized, valueType, isSensitive, isEncrypted, decryptIfNeeded } = params;
  if (serialized === null || serialized === undefined) {
    return null;
  }
  if (isSensitive) {
    return serialized.length > 0 ? SENSITIVE_SETTING_MASK : '';
  }
  const plain = decryptIfNeeded(serialized, isEncrypted);
  return deserializeSettingValue(plain, valueType);
}

export function buildSystemSettingSummary(
  params: BuildSystemSettingSummaryParams,
): SystemSettingSummary {
  const { def, context, fallbackId = 1, registry, encryptionService, decryptIfNeeded } = params;

  const resolved = registry.resolve(def.key, context, {
    maskSensitive: true,
    decryptor: (cipher) => encryptionService.decrypt(cipher),
    fromCache: true,
  });

  const overrides = registry
    .listScopeOverridesForKey(def.key)
    .map((ov, idx): SettingScopeOverrideSummary => ({
      id: ov.id ?? idx + 1,
      settingId: ov.settingId ?? def.id,
      settingKey: ov.settingKey,
      environmentCode: ov.environmentCode,
      environment: ov.environment,
      organizationUnitId: ov.organizationUnitId,
      scopeKey: ov.scopeKey,
      value: formatMaskedOrDeserializedSettingValue({
        serialized: ov.serializedValue,
        valueType: def.valueType,
        isSensitive: def.isSensitive,
        isEncrypted: ov.isEncrypted,
        decryptIfNeeded,
      }),
      isSensitive: def.isSensitive,
      isEncrypted: ov.isEncrypted,
      hasValue: ov.serializedValue.length > 0,
      updatedBy: ov.updatedBy,
      reason: ov.reason,
      updatedAt: ov.updatedAt ?? new Date().toISOString(),
    }));

  const globalFormatted = formatMaskedOrDeserializedSettingValue({
    serialized: def.globalSerializedValue,
    valueType: def.valueType,
    isSensitive: def.isSensitive,
    isEncrypted: def.isEncrypted,
    decryptIfNeeded,
  });
  const defaultFormatted = formatMaskedOrDeserializedSettingValue({
    serialized: def.defaultSerializedValue,
    valueType: def.valueType,
    isSensitive: def.isSensitive,
    isEncrypted: false,
    decryptIfNeeded,
  });

  return {
    id: def.id ?? fallbackId,
    groupId: def.groupId,
    key: def.key,
    groupCode: def.groupCode,
    module: def.module,
    namespace: def.namespace,
    name: def.name,
    description: def.description,
    valueType: def.valueType,
    valueTypeName: def.valueTypeName,
    value: resolved ? resolved.value : globalFormatted,
    globalValue: globalFormatted,
    defaultValue: defaultFormatted,
    validationRules: def.validationRules,
    isSensitive: def.isSensitive,
    isEncrypted: def.isEncrypted,
    hasValue: resolved ? resolved.hasValue : def.globalSerializedValue.length > 0,
    allowUnitOverride: def.allowUnitOverride,
    isSystem: def.isSystem,
    sortOrder: def.sortOrder,
    status: def.status,
    statusName: def.status === SETTING_ITEM_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
    resolvedSource: resolved?.resolvedSource ?? 'GLOBAL',
    resolvedEnvironment: resolved?.resolvedEnvironment ?? 'ALL',
    resolvedOrganizationUnitId: resolved?.resolvedOrganizationUnitId ?? null,
    scopeOverrides: overrides,
    updatedBy: def.updatedBy,
    updatedAt: new Date().toISOString(),
  };
}

export function mapSettingHistoryEntityToRecord(
  entity: SystemSettingHistoryEntity,
  registry: SettingRegistryService,
): SettingHistoryRecord {
  const valueType = parseSettingValueTypeCode(entity.valueType);
  const envCode = parseSettingEnvironmentCode(entity.environment);
  const envName = getSettingEnvironmentName(envCode);
  const def = registry.getDefinitionById(Number(entity.settingId));
  const settingKey = def?.key ?? `setting:${entity.settingId}`;
  const isMaskedOld = entity.oldValue === SENSITIVE_SETTING_MASK;
  const isMaskedNew = entity.newValue === SENSITIVE_SETTING_MASK;

  return {
    id: Number(entity.id),
    settingId: Number(entity.settingId),
    settingKey,
    environmentCode: envCode,
    environment: envName,
    organizationUnitId: entity.organizationUnitId ?? null,
    valueType,
    valueTypeName: getSettingValueTypeName(valueType),
    oldValue:
      entity.oldValue === null || entity.oldValue === undefined
        ? null
        : isMaskedOld
          ? SENSITIVE_SETTING_MASK
          : deserializeSettingValue(entity.oldValue, valueType),
    newValue: isMaskedNew
      ? SENSITIVE_SETTING_MASK
      : deserializeSettingValue(entity.newValue, valueType),
    actorUserId: entity.actorUserId ?? null,
    actorIdentifier: entity.actorIdentifier ?? null,
    reason: entity.reason ?? null,
    ipAddress: entity.ipAddress ?? null,
    userAgent: entity.userAgent ?? null,
    requestId: entity.requestId ?? null,
    correlationId: entity.correlationId ?? null,
    createdAt:
      entity.createdAt instanceof Date
        ? entity.createdAt.toISOString()
        : String(entity.createdAt ?? new Date().toISOString()),
  };
}

export async function persistAndAuditSettingHistory(
  params: PersistAndAuditSettingHistoryParams,
): Promise<void> {
  const ctx = RequestContextService.current();
  const resolvedActor = params.actor ?? (ctx?.actor as UserIdentity | undefined) ?? null;
  const actorUserId =
    resolvedActor?.id ??
    (ctx?.userId && !Number.isNaN(Number(ctx.userId)) ? Number(ctx.userId) : null);
  const actorIdentifier =
    resolvedActor?.email ??
    resolvedActor?.username ??
    (actorUserId ? `user:${actorUserId}` : 'system');
  const ipAddress = ctx?.ipAddress ?? '127.0.0.1';
  const userAgent = ctx?.userAgent ?? null;
  const requestId = ctx?.requestId ?? ctx?.correlationId ?? null;
  const correlationId = ctx?.correlationId ?? null;

  const safeOldSerialized = params.isSensitive
    ? params.oldSerializedValue
      ? SENSITIVE_SETTING_MASK
      : null
    : params.oldSerializedValue;
  const safeNewSerialized = params.isSensitive
    ? params.newSerializedValue
      ? SENSITIVE_SETTING_MASK
      : ''
    : params.newSerializedValue;

  let savedId = params.nextHistoryId();
  if (params.historyRepository) {
    try {
      const saved = await params.historyRepository.saveEntity({
        settingId: params.settingId,
        environment: params.environmentCode,
        organizationUnitId: params.organizationUnitId,
        valueType: params.valueType,
        oldValue: safeOldSerialized,
        newValue: safeNewSerialized,
        actorUserId,
        actorIdentifier,
        reason: params.reason ?? null,
        ipAddress,
        userAgent,
        requestId,
        correlationId,
      });
      savedId = Number(saved.id);
    } catch {
      // Fallback to in-memory history
    }
  }

  const oldParsed =
    safeOldSerialized === null
      ? null
      : params.isSensitive
        ? SENSITIVE_SETTING_MASK
        : deserializeSettingValue(safeOldSerialized, params.valueType);
  const newParsed = params.isSensitive
    ? SENSITIVE_SETTING_MASK
    : deserializeSettingValue(safeNewSerialized, params.valueType);

  const historyRecord: SettingHistoryRecord = {
    id: savedId,
    settingId: params.settingId,
    settingKey: params.settingKey,
    environmentCode: params.environmentCode,
    environment: params.environment,
    organizationUnitId: params.organizationUnitId,
    valueType: params.valueType,
    valueTypeName: getSettingValueTypeName(params.valueType),
    oldValue: oldParsed,
    newValue: newParsed,
    actorUserId,
    actorIdentifier,
    reason: params.reason ?? null,
    ipAddress,
    userAgent,
    requestId,
    correlationId,
    createdAt: new Date().toISOString(),
  };

  params.inMemoryHistory.unshift(historyRecord);
  if (params.inMemoryHistory.length > MAX_IN_MEMORY_SETTING_HISTORY) {
    params.inMemoryHistory.pop();
  }

  if (params.auditLogService) {
    await params.auditLogService.record({
      actor: resolvedActor,
      actorUserId,
      actorIdentifier,
      module: SETTINGS_AUDIT_META.MODULE,
      feature: SETTINGS_AUDIT_META.FEATURES.SYSTEM_SETTINGS,
      action: params.action,
      resourceType: 'system_setting',
      resourceId: params.settingKey,
      beforeData: {
        settingId: params.settingId,
        settingKey: params.settingKey,
        environmentCode: params.environmentCode,
        environment: params.environment,
        organizationUnitId: params.organizationUnitId,
        value: oldParsed,
      },
      afterData: {
        settingId: params.settingId,
        settingKey: params.settingKey,
        environmentCode: params.environmentCode,
        environment: params.environment,
        organizationUnitId: params.organizationUnitId,
        value: newParsed,
      },
      reason: params.reason ?? null,
      ipAddress,
      userAgent,
      requestId,
      correlationId,
    });
  }
}

export async function buildAndPersistNewSettingDefinition(
  params: BuildAndPersistNewSettingParams,
): Promise<{
  def: RegisteredSettingDefinition;
  valueType: SettingValueTypeCode;
  isSensitive: boolean;
  moduleName: string;
  namespace: string;
  serializedGlobal: string;
  parsedGlobal: unknown;
}> {
  const { dto, key, actorUserId, nextSettingId, registry, encryptionService, settingRepository } =
    params;

  const groupCode = dto.groupCode.trim().toLowerCase();
  let group = registry.getGroupByCode(groupCode);
  if (!group) {
    group = registry.registerGroup({
      code: groupCode,
      module: (dto.module ?? 'settings').trim().toLowerCase(),
      name: groupCode.toUpperCase(),
    });
  }
  const groupId = group.id;

  const valueType = parseSettingValueTypeCode(dto.valueType);
  const rules: SettingValidationRules | null = dto.validationRules ?? null;

  const validatedDefault = validateAndSerializeSettingValue(
    dto.defaultValue,
    valueType,
    rules,
    key,
  );
  const initialRawValue = dto.value !== undefined ? dto.value : dto.defaultValue;
  const validatedGlobal = validateAndSerializeSettingValue(initialRawValue, valueType, rules, key);

  const isSensitive = dto.isSensitive === true;
  const storedGlobalValue =
    isSensitive && validatedGlobal.serialized.length > 0
      ? encryptionService.encrypt(validatedGlobal.serialized)
      : validatedGlobal.serialized;
  const isEncrypted = isSensitive && storedGlobalValue.startsWith('enc:v1:');

  const parts = key.split('.');
  const moduleName = (dto.module ?? parts[0] ?? 'settings').trim().toLowerCase();
  const namespace = (
    dto.namespace ?? (parts.length >= 2 ? `${moduleName}.${parts[0]}` : moduleName)
  )
    .trim()
    .toLowerCase();

  let savedEntity: SystemSettingEntity | null = null;
  if (settingRepository) {
    try {
      savedEntity = await settingRepository.saveEntity({
        settingKey: key,
        groupId,
        module: moduleName,
        namespace,
        name: dto.name.trim(),
        description: dto.description ?? null,
        valueType,
        defaultValue: validatedDefault.serialized,
        globalValue: storedGlobalValue,
        validationRulesJson: rules ? JSON.stringify(rules) : null,
        isSensitive,
        isEncrypted,
        allowUnitOverride: dto.allowUnitOverride ?? true,
        isSystem: dto.isSystem ?? false,
        sortOrder: dto.sortOrder ?? 10,
        status: SETTING_ITEM_STATUS.ACTIVE,
        updatedBy: actorUserId,
      });
    } catch {
      // Fallback to L1 memory
    }
  }

  const def: RegisteredSettingDefinition = {
    id: savedEntity?.id ? Number(savedEntity.id) : nextSettingId(),
    groupId,
    key,
    groupCode,
    module: moduleName,
    namespace,
    name: dto.name.trim(),
    description: dto.description ?? null,
    valueType,
    valueTypeName: getSettingValueTypeName(valueType),
    defaultSerializedValue: validatedDefault.serialized,
    globalSerializedValue: storedGlobalValue,
    validationRules: rules,
    isSensitive,
    isEncrypted,
    allowUnitOverride: dto.allowUnitOverride ?? true,
    isSystem: dto.isSystem ?? false,
    sortOrder: dto.sortOrder ?? 10,
    status: SETTING_ITEM_STATUS.ACTIVE,
    updatedBy: actorUserId,
  };

  registry.upsertDefinition(def);
  return {
    def,
    valueType,
    isSensitive,
    moduleName,
    namespace,
    serializedGlobal: validatedGlobal.serialized,
    parsedGlobal: validatedGlobal.parsedValue,
  };
}

export async function persistGlobalSettingUpdateRecord(
  params: PersistGlobalSettingUpdateParams,
): Promise<string | null> {
  const {
    def,
    normKey,
    dto,
    effectiveRules,
    encryptedValue,
    isEncrypted,
    actorUserId,
    registry,
    settingRepository,
    decryptIfNeeded,
  } = params;
  const oldPlainSerialized = decryptIfNeeded(def.globalSerializedValue, def.isEncrypted);

  const updatedDef: RegisteredSettingDefinition = {
    ...def,
    name: dto.name?.trim() || def.name,
    description: dto.description !== undefined ? dto.description : def.description,
    allowUnitOverride:
      dto.allowUnitOverride !== undefined ? dto.allowUnitOverride : def.allowUnitOverride,
    validationRules: effectiveRules,
    globalSerializedValue: encryptedValue,
    isEncrypted,
    updatedBy: actorUserId,
  };

  if (settingRepository) {
    try {
      const existingDb = await settingRepository.findByKey(normKey);
      if (existingDb) {
        await settingRepository.saveEntity({
          ...existingDb,
          name: updatedDef.name,
          description: updatedDef.description,
          allowUnitOverride: updatedDef.allowUnitOverride,
          validationRulesJson: updatedDef.validationRules
            ? JSON.stringify(updatedDef.validationRules)
            : null,
          globalValue: encryptedValue,
          isEncrypted,
          updatedBy: actorUserId,
        });
      }
    } catch {
      // Fallback to L1 memory
    }
  }

  registry.upsertDefinition(updatedDef);
  return oldPlainSerialized;
}

export async function persistScopedSettingUpdateRecord(
  params: PersistScopedSettingUpdateParams,
): Promise<string | null> {
  const {
    def,
    normKey,
    envCode,
    normEnv,
    unitId,
    encryptedValue,
    isEncrypted,
    actorUserId,
    reason,
    nextScopeId,
    registry,
    scopeRepository,
    decryptIfNeeded,
  } = params;

  const scopeKey = buildSettingScopeKey(normKey, normEnv, unitId);
  const existingOverride = registry
    .listScopeOverridesForKey(normKey)
    .find((o) => o.scopeKey === scopeKey);
  const oldPlainSerialized = existingOverride
    ? decryptIfNeeded(existingOverride.serializedValue, existingOverride.isEncrypted)
    : null;

  let savedScope: SystemSettingScopeEntity | null = null;
  if (scopeRepository) {
    try {
      const existingDbScope = await scopeRepository.findByScope(def.id, envCode, unitId);
      savedScope = await scopeRepository.saveEntity({
        ...(existingDbScope ? { id: existingDbScope.id } : {}),
        settingId: def.id,
        environment: envCode,
        organizationUnitId: unitId,
        settingValue: encryptedValue,
        isEncrypted,
        updatedBy: actorUserId,
        reason,
      });
    } catch {
      // Fallback to L1 memory
    }
  }

  registry.upsertScopeOverride({
    id: savedScope?.id ? Number(savedScope.id) : (existingOverride?.id ?? nextScopeId()),
    settingId: def.id,
    settingKey: normKey,
    environmentCode: envCode,
    environment: normEnv,
    organizationUnitId: unitId,
    scopeKey,
    serializedValue: encryptedValue,
    isEncrypted,
    updatedBy: actorUserId,
    reason,
    updatedAt: new Date().toISOString(),
  });

  return oldPlainSerialized;
}
