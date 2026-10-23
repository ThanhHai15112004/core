import {
  type RegisteredSettingGroup,
  type RegisteredSettingScopeOverride,
  SETTING_ITEM_STATUS,
  type SettingValidationRules,
  buildSettingScopeKey,
  deserializeSettingValue,
  getSettingEnvironmentName,
  getSettingValueTypeName,
  parseSettingEnvironmentCode,
  parseSettingValueTypeCode,
  safeJsonParse,
  validateAndSerializeSettingValue,
} from '@packages/kernel/index.js';
import type {
  HydrateSettingRegistryParams,
  UpsertSettingDefinitionManifestParams,
  UpsertSettingGroupManifestParams,
} from '../types/settings.types.js';

export async function upsertSettingGroupFromManifest(
  params: UpsertSettingGroupManifestParams,
): Promise<void> {
  const { grp, groupRepository, registry } = params;
  const code = grp.code.trim().toLowerCase();
  const moduleName = (grp.module ?? 'settings').trim().toLowerCase();
  let dbId: number | undefined;

  if (groupRepository) {
    try {
      const existing = await groupRepository.findByCode(code);
      const saved = await groupRepository.saveEntity({
        ...(existing ? { id: existing.id } : {}),
        code,
        module: moduleName,
        name: existing?.name || grp.name.trim(),
        description: existing?.description ?? grp.description ?? null,
        icon: existing?.icon ?? grp.icon ?? null,
        sortOrder: grp.sortOrder ?? existing?.sortOrder ?? 0,
        isSystem: grp.isSystem ?? true,
        status: SETTING_ITEM_STATUS.ACTIVE,
      });
      dbId = Number(saved.id);
    } catch {
      // Ignore when DB table is not available
    }
  }

  registry.registerGroup({
    ...grp,
    ...(dbId ? { id: dbId } : {}),
    code,
    module: moduleName,
  });
}

export async function upsertSettingDefinitionFromManifest(
  params: UpsertSettingDefinitionManifestParams,
): Promise<number> {
  const { item, settingRepository, scopeRepository, registry, encryptionService } = params;
  const key = item.key.trim().toLowerCase();
  const valueType = parseSettingValueTypeCode(item.valueType);
  const validatedDefault = validateAndSerializeSettingValue(
    item.defaultValue,
    valueType,
    item.validationRules,
    key,
  );
  const parts = key.split('.');
  const groupCode = (item.groupCode || parts[0] || 'system').trim().toLowerCase();
  const moduleName = (item.module ?? 'settings').trim().toLowerCase();
  const namespace = (
    item.namespace ?? (parts.length >= 2 ? `${moduleName}.${parts[0]}` : moduleName)
  )
    .trim()
    .toLowerCase();

  let group = registry.getGroupByCode(groupCode);
  if (!group) {
    group = registry.registerGroup({
      code: groupCode,
      module: moduleName,
      name: groupCode.toUpperCase(),
    });
  }
  const groupId = group.id;

  const isSensitive = item.isSensitive === true;
  const encryptedDefault =
    isSensitive && validatedDefault.serialized.length > 0
      ? encryptionService.encrypt(validatedDefault.serialized)
      : validatedDefault.serialized;
  const isEncrypted = isSensitive && encryptedDefault.startsWith('enc:v1:');

  let savedSettingId: number | undefined;
  if (settingRepository) {
    try {
      const existing = await settingRepository.findByKey(key);
      if (!existing) {
        const saved = await settingRepository.saveEntity({
          settingKey: key,
          groupId,
          module: moduleName,
          namespace,
          name: item.name.trim(),
          description: item.description ?? null,
          valueType,
          defaultValue: validatedDefault.serialized,
          globalValue: encryptedDefault,
          validationRulesJson: item.validationRules ? JSON.stringify(item.validationRules) : null,
          isSensitive,
          isEncrypted,
          allowUnitOverride: item.allowUnitOverride ?? true,
          isSystem: item.isSystem ?? true,
          sortOrder: item.sortOrder ?? 0,
          status: SETTING_ITEM_STATUS.ACTIVE,
        });
        savedSettingId = Number(saved.id);
      } else {
        savedSettingId = Number(existing.id);
      }
    } catch {
      // Ignore when DB table is not available
    }
  }

  const registeredDef = registry.registerManifestSetting({
    ...item,
    ...(savedSettingId ? { id: savedSettingId } : {}),
    groupId,
  });
  const effectiveSettingId = savedSettingId ?? registeredDef.id;

  let envCount = 0;
  if (item.environmentOverrides && typeof item.environmentOverrides === 'object') {
    for (const [envKey, envVal] of Object.entries(item.environmentOverrides)) {
      const envCode = parseSettingEnvironmentCode(envKey);
      const validatedEnv = validateAndSerializeSettingValue(
        envVal,
        valueType,
        item.validationRules,
        key,
      );
      if (scopeRepository) {
        try {
          const existingScope = await scopeRepository.findByScope(
            effectiveSettingId,
            envCode,
            null,
          );
          if (!existingScope) {
            await scopeRepository.saveEntity({
              settingId: effectiveSettingId,
              environment: envCode,
              organizationUnitId: null,
              settingValue: validatedEnv.serialized,
              isEncrypted: false,
              reason: 'Manifest environment default',
            });
          }
        } catch {
          // Ignore when DB table is not available
        }
      }
      envCount++;
    }
  }

  return envCount;
}

export async function hydrateSettingRegistryFromDatabase(
  params: HydrateSettingRegistryParams,
): Promise<void> {
  const {
    groupRepository,
    settingRepository,
    scopeRepository,
    registry,
    decryptIfNeeded,
    invalidateSettingCacheForKey,
    publishSettingChanged,
  } = params;

  if (groupRepository) {
    try {
      const dbGroups = await groupRepository.findFiltered();
      if (dbGroups.length > 0) {
        const seenCodes = new Set<string>();
        for (const g of dbGroups) {
          const normCode = g.code.trim().toLowerCase();
          seenCodes.add(normCode);
          const group: RegisteredSettingGroup = {
            id: Number(g.id),
            code: normCode,
            module: g.module.trim().toLowerCase(),
            name: g.name,
            description: g.description ?? null,
            icon: g.icon ?? null,
            sortOrder: g.sortOrder ?? 0,
            isSystem: g.isSystem ?? true,
            status:
              g.status === SETTING_ITEM_STATUS.INACTIVE
                ? SETTING_ITEM_STATUS.INACTIVE
                : SETTING_ITEM_STATUS.ACTIVE,
          };
          registry.registerGroup(group);
        }
        for (const existingGrp of registry.listGroups()) {
          if (existingGrp.id !== undefined && !seenCodes.has(existingGrp.code)) {
            registry.removeGroup(existingGrp.code);
          }
        }
      }
    } catch {
      // Ignore when DB is not ready
    }
  }

  if (settingRepository) {
    try {
      const dbSettings = await settingRepository.findFiltered();
      if (dbSettings.length > 0) {
        const seenKeys = new Set<string>();
        for (const s of dbSettings) {
          const normKey = s.settingKey.trim().toLowerCase();
          seenKeys.add(normKey);
          const existingDef = registry.getDefinition(normKey);
          const groupId = Number(s.groupId ?? existingDef?.groupId ?? 1);
          const groupCode = (
            registry.getGroupById(groupId)?.code ??
            existingDef?.groupCode ??
            normKey.split('.')[0] ??
            'system'
          )
            .trim()
            .toLowerCase();
          const valueType = parseSettingValueTypeCode(s.valueType);
          const rules = safeJsonParse<SettingValidationRules>(s.validationRulesJson, null);
          const nextStatus =
            s.status === SETTING_ITEM_STATUS.INACTIVE
              ? SETTING_ITEM_STATUS.INACTIVE
              : SETTING_ITEM_STATUS.ACTIVE;

          const valueChangedInDb =
            !existingDef ||
            existingDef.globalSerializedValue !== s.globalValue ||
            existingDef.defaultSerializedValue !== s.defaultValue ||
            existingDef.isEncrypted !== Boolean(s.isEncrypted) ||
            existingDef.isSensitive !== Boolean(s.isSensitive) ||
            existingDef.allowUnitOverride !== Boolean(s.allowUnitOverride) ||
            existingDef.status !== nextStatus ||
            existingDef.name !== s.name;

          registry.upsertDefinition({
            id: Number(s.id),
            groupId,
            key: normKey,
            groupCode,
            module: s.module.trim().toLowerCase(),
            namespace: s.namespace.trim().toLowerCase(),
            name: s.name,
            description: s.description ?? null,
            valueType,
            valueTypeName: getSettingValueTypeName(valueType),
            defaultSerializedValue: s.defaultValue,
            globalSerializedValue: s.globalValue,
            validationRules: rules,
            isSensitive: Boolean(s.isSensitive),
            isEncrypted: Boolean(s.isEncrypted),
            allowUnitOverride: Boolean(s.allowUnitOverride),
            isSystem: Boolean(s.isSystem),
            sortOrder: s.sortOrder ?? 0,
            status: nextStatus,
            updatedBy: s.updatedBy ?? null,
          });

          if (valueChangedInDb) {
            await invalidateSettingCacheForKey(normKey);
            if (existingDef && existingDef.globalSerializedValue !== s.globalValue) {
              const plainSerialized = decryptIfNeeded(s.globalValue, Boolean(s.isEncrypted));
              const parsedValue = deserializeSettingValue(plainSerialized, valueType);
              await publishSettingChanged({
                key: normKey,
                module: s.module.trim().toLowerCase(),
                namespace: s.namespace.trim().toLowerCase(),
                environment: 'ALL',
                organizationUnitId: null,
                value: parsedValue,
              });
            }
          }
        }

        for (const existingDef of registry.listDefinitions()) {
          if (existingDef.id !== undefined && !seenKeys.has(existingDef.key)) {
            registry.removeDefinition(existingDef.key);
            await invalidateSettingCacheForKey(existingDef.key);
          }
        }
      }
    } catch {
      // Ignore when DB is not ready
    }
  }

  if (scopeRepository) {
    try {
      const dbScopes = await scopeRepository.findAllScopes();
      const seenScopeKeys = new Set<string>();
      const existingScopesByKey = new Map(
        registry.listAllScopeOverrides().map((o) => [o.scopeKey, o]),
      );

      for (const sc of dbScopes) {
        const settingId = Number(sc.settingId);
        const def = registry.getDefinitionById(settingId);
        if (!def) continue;
        const envCode = parseSettingEnvironmentCode(sc.environment);
        const envName = getSettingEnvironmentName(envCode);
        const unitId = sc.organizationUnitId ?? null;
        const scopeKey = buildSettingScopeKey(def.key, envName, unitId);

        seenScopeKeys.add(scopeKey);
        const prev = existingScopesByKey.get(scopeKey);
        const changed =
          !prev ||
          prev.serializedValue !== sc.settingValue ||
          prev.isEncrypted !== Boolean(sc.isEncrypted);

        const override: RegisteredSettingScopeOverride = {
          id: Number(sc.id),
          settingId,
          settingKey: def.key,
          environmentCode: envCode,
          environment: envName,
          organizationUnitId: unitId,
          scopeKey,
          serializedValue: sc.settingValue,
          isEncrypted: Boolean(sc.isEncrypted),
          updatedBy: sc.updatedBy ?? null,
          reason: sc.reason ?? null,
          updatedAt:
            sc.updatedAt instanceof Date
              ? sc.updatedAt.toISOString()
              : String(sc.updatedAt ?? new Date().toISOString()),
        };
        registry.upsertScopeOverride(override);

        if (changed) {
          await invalidateSettingCacheForKey(override.settingKey);
        }
      }

      for (const existingOverride of existingScopesByKey.values()) {
        if (existingOverride.id !== undefined && !seenScopeKeys.has(existingOverride.scopeKey)) {
          registry.removeScopeOverrideByScopeKey(existingOverride.scopeKey);
          await invalidateSettingCacheForKey(existingOverride.settingKey);
        }
      }
    } catch {
      // Ignore when DB is not ready
    }
  }
}
