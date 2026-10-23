import {
  CODE_ITEM_STATUS,
  type CodeTypeManifestItem,
  type CodeValueManifestItem,
  safeJsonParseObject,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import type { SyncCodesResult } from '../contracts/index.js';
import type { CodeValueEntity } from '../entities/code-value.entity.js';
import type {
  CodeRegistryRefreshParams,
  SingleCodeTypeRefreshParams,
  SyncDeclaredCodeTypesParams,
} from '../types/codes.types.js';

export function mapCodeValueEntityToManifestItem(
  entity: CodeValueEntity,
  manifestCodeTypes: ReadonlyMap<string, CodeTypeManifestItem>,
): CodeValueManifestItem {
  const labels = {
    ...safeJsonParseObject<Record<string, string>>(entity.labelsJson, {}),
  };
  const manifestType = manifestCodeTypes.get(entity.typeCode.trim().toLowerCase());
  const manifestVal = manifestType?.values?.find(
    (v) => Number(v.numericCode) === Number(entity.numericCode),
  );
  if (
    entity.name &&
    (!labels.vi ||
      (manifestVal && entity.name !== manifestVal.name && labels.vi === manifestVal.labels?.vi))
  ) {
    labels.vi = entity.name;
  }

  return {
    numericCode: Number(entity.numericCode),
    code: entity.code,
    behaviorCode: entity.behaviorCode ?? null,
    name: entity.name,
    description: entity.description ?? null,
    labels,
    aliases: safeJsonParseStringArray(entity.aliasesJson),
    color: entity.color ?? null,
    icon: entity.icon ?? null,
    sortOrder: Number(entity.sortOrder ?? entity.numericCode),
    isDefault: Boolean(entity.isDefault),
    isSystem: Boolean(entity.isSystem),
    metadata: safeJsonParseObject<Record<string, unknown> | null>(entity.metadataJson, null),
    status:
      Number(entity.status) === CODE_ITEM_STATUS.INACTIVE
        ? CODE_ITEM_STATUS.INACTIVE
        : CODE_ITEM_STATUS.ACTIVE,
  };
}

export async function refreshSingleCodeTypeFromDatabase(
  params: SingleCodeTypeRefreshParams,
): Promise<void> {
  const { typeCode, codeTypeRepository, codeValueRepository, registry, manifestCodeTypes } = params;
  try {
    const normalized = typeCode.trim().toLowerCase();
    const [ct, rows] = await Promise.all([
      codeTypeRepository.findByCode(normalized),
      codeValueRepository.findByTypeCode(normalized, true),
    ]);
    if (!ct) return;

    registry.replaceTypeValues(
      {
        code: normalized,
        module: ct.module,
        name: ct.name,
        description: ct.description ?? null,
        isSystem: Boolean(ct.isSystem),
        allowCustomValues: Boolean(ct.allowCustomValues),
        status:
          Number(ct.status) === CODE_ITEM_STATUS.INACTIVE
            ? CODE_ITEM_STATUS.INACTIVE
            : CODE_ITEM_STATUS.ACTIVE,
      },
      rows.map((r) => mapCodeValueEntityToManifestItem(r, manifestCodeTypes)),
    );
  } catch {
    // Safe fallback to L1 memory
  }
}

export async function refreshCodeRegistryFromDatabase(
  params: CodeRegistryRefreshParams,
): Promise<void> {
  const { codeTypeRepository, codeValueRepository, registry, manifestCodeTypes } = params;
  try {
    const [dbTypes, dbValues] = await Promise.all([
      codeTypeRepository.findFiltered({}),
      codeValueRepository.findAllOrdered(true),
    ]);
    if (dbTypes.length === 0 && dbValues.length === 0) return;

    const valuesByType = new Map<string, CodeValueEntity[]>();
    for (const v of dbValues) {
      const key = v.typeCode.trim().toLowerCase();
      const list = valuesByType.get(key) ?? [];
      list.push(v);
      valuesByType.set(key, list);
    }

    for (const ct of dbTypes) {
      const key = ct.code.trim().toLowerCase();
      const rows = valuesByType.get(key) ?? [];
      registry.replaceTypeValues(
        {
          code: key,
          module: ct.module,
          name: ct.name,
          description: ct.description ?? null,
          isSystem: Boolean(ct.isSystem),
          allowCustomValues: Boolean(ct.allowCustomValues),
          status:
            Number(ct.status) === CODE_ITEM_STATUS.INACTIVE
              ? CODE_ITEM_STATUS.INACTIVE
              : CODE_ITEM_STATUS.ACTIVE,
        },
        rows.map((r) => mapCodeValueEntityToManifestItem(r, manifestCodeTypes)),
      );
    }
  } catch {
    // Safe fallback to L1 memory
  }
}

export async function syncDeclaredCodeTypesAndValuesToDatabase(
  params: SyncDeclaredCodeTypesParams,
): Promise<SyncCodesResult> {
  const { allDeclared, codeTypeRepository, codeValueRepository, registry, manifestCodeTypes } =
    params;

  registry.registerManifestTypes(allDeclared);

  const syncedModules = new Set<string>();
  let createdTypesCount = 0;
  let updatedTypesCount = 0;
  let totalCodeValues = 0;
  let createdValuesCount = 0;
  let updatedValuesCount = 0;

  for (const declared of allDeclared) {
    const typeCode = declared.code.trim().toLowerCase();
    const moduleName = (declared.module ?? typeCode.split('.')[0] ?? 'core').trim().toLowerCase();
    syncedModules.add(moduleName);

    const existingType = await codeTypeRepository.findByCode(typeCode);
    if (!existingType) {
      await codeTypeRepository.saveEntity({
        code: typeCode,
        module: moduleName,
        name: declared.name.trim(),
        description: declared.description ?? null,
        isSystem: declared.isSystem ?? true,
        allowCustomValues: declared.allowCustomValues ?? true,
        status: CODE_ITEM_STATUS.ACTIVE,
      });
      createdTypesCount++;
    } else {
      existingType.module = moduleName;
      existingType.name = declared.name.trim();
      if (declared.description !== undefined) {
        existingType.description = declared.description;
      }
      existingType.isSystem = declared.isSystem ?? existingType.isSystem;
      existingType.allowCustomValues = declared.allowCustomValues ?? existingType.allowCustomValues;
      await codeTypeRepository.saveEntity(existingType);
      updatedTypesCount++;
    }

    const existingValues = await codeValueRepository.findByTypeCode(typeCode, true);
    const byNumeric = new Map<number, CodeValueEntity>(
      existingValues.map((v) => [Number(v.numericCode), v]),
    );

    for (const val of declared.values ?? []) {
      totalCodeValues++;
      const existingVal = byNumeric.get(Number(val.numericCode));
      const normalizedCode = val.code.trim().toUpperCase();
      const normalizedBehavior = val.behaviorCode ? val.behaviorCode.trim().toUpperCase() : null;

      if (!existingVal) {
        await codeValueRepository.saveEntity({
          typeCode,
          numericCode: Number(val.numericCode),
          code: normalizedCode,
          behaviorCode: normalizedBehavior,
          name: val.name.trim(),
          description: val.description ?? null,
          labelsJson: val.labels ? JSON.stringify(val.labels) : null,
          aliasesJson: val.aliases ? JSON.stringify(val.aliases) : null,
          color: val.color ?? null,
          icon: val.icon ?? null,
          sortOrder: val.sortOrder ?? val.numericCode,
          isDefault: val.isDefault ?? false,
          isSystem: val.isSystem ?? true,
          metadataJson: val.metadata ? JSON.stringify(val.metadata) : null,
          status:
            val.status === CODE_ITEM_STATUS.INACTIVE
              ? CODE_ITEM_STATUS.INACTIVE
              : CODE_ITEM_STATUS.ACTIVE,
        });
        createdValuesCount++;
      } else {
        existingVal.code = normalizedCode;
        existingVal.behaviorCode = normalizedBehavior ?? existingVal.behaviorCode ?? null;
        if (!existingVal.labelsJson && val.labels) {
          existingVal.labelsJson = JSON.stringify(val.labels);
        }
        if (!existingVal.aliasesJson && val.aliases) {
          existingVal.aliasesJson = JSON.stringify(val.aliases);
        }
        if (!existingVal.color && val.color) {
          existingVal.color = val.color;
        }
        if (!existingVal.icon && val.icon) {
          existingVal.icon = val.icon;
        }
        if (!existingVal.metadataJson && val.metadata) {
          existingVal.metadataJson = JSON.stringify(val.metadata);
        }
        existingVal.isSystem = val.isSystem ?? existingVal.isSystem;
        await codeValueRepository.saveEntity(existingVal);
        updatedValuesCount++;
      }
    }

    await refreshSingleCodeTypeFromDatabase({
      typeCode,
      codeTypeRepository,
      codeValueRepository,
      registry,
      manifestCodeTypes,
    });
  }

  return {
    syncedModules: [...syncedModules].sort(),
    totalCodeTypes: allDeclared.length,
    createdTypesCount,
    updatedTypesCount,
    totalCodeValues,
    createdValuesCount,
    updatedValuesCount,
  };
}
