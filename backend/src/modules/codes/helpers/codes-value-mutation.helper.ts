import {
  CODE_ITEM_STATUS,
  type CodeItemStatusCode,
  type CodeRegistryService,
  ConflictAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import type { CodeTypeSummary } from '../contracts/index.js';
import type { CodeTypeEntity } from '../entities/code-type.entity.js';
import type { CodeValueEntity } from '../entities/code-value.entity.js';
import type { CodeValueRepository } from '../repositories/code-value.repository.js';
import type { UpdateCodeValueRequest } from '../requests/codes.requests.js';
import type { CodeTypeSummaryBuildOptions } from '../types/codes.types.js';

export async function validateCodeValueCodeChange(params: {
  normalizedType: string;
  numericCode: number;
  entity: CodeValueEntity;
  rawNextCode: string;
  registry: CodeRegistryService;
  codeValueRepository: CodeValueRepository;
}): Promise<void> {
  const { normalizedType, numericCode, entity, rawNextCode, registry, codeValueRepository } =
    params;
  const nextCode = rawNextCode.trim().toUpperCase();
  if (nextCode === entity.code.trim().toUpperCase()) return;

  if (entity.isSystem) {
    throw new ForbiddenAppException('codes.cannotChangeSystemCode', [
      { typeCode: normalizedType, code: entity.code },
    ]);
  }

  const usage = await registry.checkValueUsage(normalizedType, numericCode, entity.code);
  if (usage.inUse) {
    throw new ConflictAppException(
      'codes.cannotChangeCodeInUse',
      [
        {
          typeCode: normalizedType,
          numericCode,
          code: entity.code,
          usageCount: usage.totalUsageCount,
          details: usage.details,
        },
      ],
      {
        typeCode: normalizedType,
        numericCode,
        code: entity.code,
        usageCount: usage.totalUsageCount,
      },
      HTTP_ERROR_CODE.CONFLICT,
    );
  }

  const existingValues = await codeValueRepository.findByTypeCode(normalizedType, true);
  const duplicate = existingValues.find(
    (v) =>
      Number(v.numericCode) !== Number(numericCode) && v.code.trim().toUpperCase() === nextCode,
  );
  if (duplicate) {
    throw new ConflictAppException(
      'codes.duplicateValueCode',
      [{ typeCode: normalizedType, code: nextCode }],
      { typeCode: normalizedType, code: nextCode },
      HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
    );
  }
}

export function applyCodeValueUpdatesToEntity(
  entity: CodeValueEntity,
  dto: UpdateCodeValueRequest,
): void {
  if (dto.code !== undefined) {
    entity.code = dto.code.trim().toUpperCase();
  }
  if (dto.name !== undefined) {
    entity.name = dto.name.trim();
    const existingLabels = safeJsonParseObject<Record<string, string>>(entity.labelsJson, {});
    if (dto.labels?.vi === undefined) {
      existingLabels.vi = entity.name;
      entity.labelsJson = JSON.stringify(existingLabels);
    }
  }
  if (dto.description !== undefined) entity.description = dto.description;
  if (dto.behaviorCode !== undefined && !entity.isSystem) {
    entity.behaviorCode = dto.behaviorCode ? dto.behaviorCode.trim().toUpperCase() : null;
  }
  if (dto.labels !== undefined) {
    const existingLabels = safeJsonParseObject<Record<string, string>>(entity.labelsJson, {});
    entity.labelsJson = JSON.stringify({ ...existingLabels, ...dto.labels });
  }
  if (dto.aliases !== undefined) {
    entity.aliasesJson = JSON.stringify(dto.aliases);
  }
  if (dto.color !== undefined) entity.color = dto.color;
  if (dto.icon !== undefined) entity.icon = dto.icon;
  if (dto.sortOrder !== undefined) entity.sortOrder = dto.sortOrder;
  if (dto.isDefault !== undefined) entity.isDefault = dto.isDefault;
  if (dto.metadata !== undefined) {
    entity.metadataJson = dto.metadata ? JSON.stringify(dto.metadata) : null;
  }
  if (dto.status !== undefined) {
    entity.status = dto.status as CodeItemStatusCode;
  }
}

export function mapEntityToCodeTypeSummary(
  ct: CodeTypeEntity,
  registry: CodeRegistryService,
  effectiveLocale: string,
  options?: CodeTypeSummaryBuildOptions,
): CodeTypeSummary {
  const values = registry.listValues(ct.code, {
    includeInactive: true,
    locale: effectiveLocale,
  });
  return {
    id: Number(ct.id),
    code: ct.code,
    module: ct.module,
    name: ct.name,
    description: ct.description ?? null,
    isSystem: Boolean(ct.isSystem),
    allowCustomValues: Boolean(ct.allowCustomValues),
    status:
      Number(ct.status) === CODE_ITEM_STATUS.INACTIVE
        ? CODE_ITEM_STATUS.INACTIVE
        : CODE_ITEM_STATUS.ACTIVE,
    totalValues: values.length,
    ...(options?.includeValues ? { values } : {}),
  };
}
