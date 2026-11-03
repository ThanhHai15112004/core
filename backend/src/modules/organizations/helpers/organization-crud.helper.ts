import {
  BadRequestAppException,
  ConflictAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
} from '@packages/kernel/index.js';
import type { AuditLogService } from '@packages/security/index.js';
import {
  ORG_UNIT_STATUS,
  type OrganizationUnitSummary,
  type UnitManagerResolverDelegate,
  parseOrgUnitStatus,
  parseOrgUnitType,
} from '../contracts/index.js';
import type { OrganizationUnitEntity } from '../entities/organization-unit.entity.js';
import {
  ensureHierarchyDepthAllowed,
  validateAndComputeMoveImpact,
} from './organization-hierarchy.helper.js';
import type { OrganizationsMapper } from '../mappers/organizations.mapper.js';
import type { OrganizationUnitRepository } from '../repositories/organization-unit.repository.js';
import type {
  CreateOrganizationUnitRequest,
  UpdateOrganizationUnitRequest,
} from '../requests/organizations.requests.js';
import type { OrganizationUnitResponse } from '../responses/organizations.response.js';
import type { UnitUsageCountDelegate } from '../types/organizations.types.js';

export async function resolveUnitManagerNamesMap(
  units: readonly OrganizationUnitEntity[],
  unitManagerResolverDelegate?: UnitManagerResolverDelegate,
): Promise<ReadonlyMap<number, string>> {
  const map = new Map<number, string>();
  if (!unitManagerResolverDelegate) return map;

  const managerIds = [
    ...new Set(
      units
        .map((u) => (u.managerId !== undefined && u.managerId !== null ? Number(u.managerId) : 0))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
  if (managerIds.length === 0) return map;

  const managers = await unitManagerResolverDelegate({ userIds: managerIds });
  for (const m of managers) {
    map.set(Number(m.id), m.fullName || m.username);
  }
  return map;
}

export async function validateUnitManagerIdOrThrow(
  managerId: number | null | undefined,
  unitManagerResolverDelegate?: UnitManagerResolverDelegate,
): Promise<string | null> {
  if (managerId === undefined || managerId === null) return null;
  if (!unitManagerResolverDelegate) return null;

  const found = await unitManagerResolverDelegate({ userIds: [Number(managerId)] });
  const manager = found.find((m) => Number(m.id) === Number(managerId));
  if (!manager) {
    throw new BadRequestAppException('organizations.invalidManagerId', [{ managerId }]);
  }
  return manager.fullName || manager.username;
}

export async function executeCreateOrganizationUnit(params: {
  dto: CreateOrganizationUnitRequest;
  repository: OrganizationUnitRepository;
  mapper: OrganizationsMapper;
  maxHierarchyDepth: number;
  unitManagerResolverDelegate?: UnitManagerResolverDelegate | undefined;
  auditLogService: AuditLogService | null;
}): Promise<OrganizationUnitResponse> {
  const {
    dto,
    repository,
    mapper,
    maxHierarchyDepth,
    unitManagerResolverDelegate,
    auditLogService,
  } = params;

  const normalizedCode = dto.code.trim().toUpperCase();
  const existing = await repository.findByCode(normalizedCode);
  if (existing) {
    throw new ConflictAppException(
      'organizations.duplicateCode',
      [{ code: normalizedCode }],
      { code: normalizedCode },
      HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
    );
  }

  if (dto.parentId) {
    const parent = await repository.findById(dto.parentId);
    if (!parent) {
      throw new BadRequestAppException('organizations.parentNotFound', [
        { parentId: dto.parentId },
      ]);
    }
    if (Number(parent.status) !== ORG_UNIT_STATUS.ACTIVE) {
      throw new BadRequestAppException('organizations.parentUnitLocked', [
        { parentId: dto.parentId, status: parent.status },
      ]);
    }
    const allUnits = await repository.findFiltered({});
    ensureHierarchyDepthAllowed({
      allUnits,
      parentId: Number(dto.parentId),
      subtreeDepthBelowNode: 0,
      maxDepth: maxHierarchyDepth,
    });
  }

  const managerName = await validateUnitManagerIdOrThrow(
    dto.managerId,
    unitManagerResolverDelegate,
  );

  const saved = await repository.saveEntity({
    code: normalizedCode,
    name: dto.name.trim(),
    type: parseOrgUnitType(dto.type),
    parentId: dto.parentId ?? null,
    managerId: dto.managerId ?? null,
    status: parseOrgUnitStatus(dto.status),
    description: dto.description ?? null,
  });

  const response = mapper.toResponse(saved, managerName);
  await auditLogService?.record({
    module: 'organizations',
    feature: 'organization-unit-management',
    action: 'organization_unit.create',
    resourceType: 'organization_unit',
    resourceId: response.id,
    beforeData: null,
    afterData: {
      id: response.id,
      code: response.code,
      name: response.name,
      type: response.type,
      parentId: response.parentId,
      managerId: response.managerId,
      status: response.status,
    },
    reason: 'Created organization unit',
  });
  return response;
}

export async function executeUpdateOrganizationUnit(params: {
  id: number;
  dto: UpdateOrganizationUnitRequest;
  repository: OrganizationUnitRepository;
  mapper: OrganizationsMapper;
  maxHierarchyDepth: number;
  unitManagerResolverDelegate?: UnitManagerResolverDelegate | undefined;
  auditLogService: AuditLogService | null;
}): Promise<OrganizationUnitResponse> {
  const {
    id,
    dto,
    repository,
    mapper,
    maxHierarchyDepth,
    unitManagerResolverDelegate,
    auditLogService,
  } = params;

  const entity = await repository.findById(id);
  if (!entity) {
    throw new NotFoundAppException('organizations.notFound', { id });
  }
  const beforeSnapshot = {
    id: entity.id,
    code: entity.code,
    name: entity.name,
    type: entity.type,
    parentId: entity.parentId,
    managerId: entity.managerId ?? null,
    status: entity.status,
    description: entity.description,
  };

  if (dto.code !== undefined) {
    const normalizedCode = dto.code.trim().toUpperCase();
    if (normalizedCode !== entity.code) {
      const duplicate = await repository.findByCode(normalizedCode);
      if (duplicate && Number(duplicate.id) !== Number(id)) {
        throw new ConflictAppException(
          'organizations.duplicateCode',
          [{ code: normalizedCode }],
          { code: normalizedCode },
          HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
        );
      }
      entity.code = normalizedCode;
    }
  }

  if (dto.parentId !== undefined) {
    const allUnits = await repository.findFiltered({});
    validateAndComputeMoveImpact({
      allUnits,
      unitId: Number(id),
      newParentId: dto.parentId,
      maxDepth: maxHierarchyDepth,
      affectedUserCount: 0,
    });
  }

  let resolvedManagerName: string | null = null;
  if (dto.managerId !== undefined) {
    resolvedManagerName = await validateUnitManagerIdOrThrow(
      dto.managerId,
      unitManagerResolverDelegate,
    );
    entity.managerId = dto.managerId;
  } else if (entity.managerId) {
    const managerMap = await resolveUnitManagerNamesMap([entity], unitManagerResolverDelegate);
    resolvedManagerName = managerMap.get(Number(entity.managerId)) ?? null;
  }

  if (dto.name !== undefined) entity.name = dto.name.trim();
  if (dto.type !== undefined) entity.type = dto.type;
  if (dto.parentId !== undefined) entity.parentId = dto.parentId;
  if (dto.status !== undefined) entity.status = dto.status;
  if (dto.description !== undefined) entity.description = dto.description;

  const saved = await repository.saveEntity(entity);
  const response = mapper.toResponse(saved, resolvedManagerName);
  await auditLogService?.record({
    module: 'organizations',
    feature: 'organization-unit-management',
    action: 'organization_unit.update',
    resourceType: 'organization_unit',
    resourceId: id,
    beforeData: beforeSnapshot,
    afterData: {
      id: response.id,
      code: response.code,
      name: response.name,
      type: response.type,
      parentId: response.parentId,
      managerId: response.managerId,
      status: response.status,
      description: response.description,
    },
    reason: 'Updated organization unit',
  });
  return response;
}

export async function executeRemoveOrganizationUnit(params: {
  id: number;
  repository: OrganizationUnitRepository;
  unitUsageCountDelegate?: UnitUsageCountDelegate | undefined;
  auditLogService: AuditLogService | null;
}): Promise<{ deleted: true; id: number }> {
  const { id, repository, unitUsageCountDelegate, auditLogService } = params;
  const entity = await repository.findById(id);
  if (!entity) {
    throw new NotFoundAppException('organizations.notFound', { id });
  }

  const children = await repository.findFiltered({ parentId: Number(id) });
  const activeChildren = children.filter((c) => !c.deletedAt && Number(c.id) !== Number(id));
  if (activeChildren.length > 0) {
    throw new ConflictAppException(
      'organizations.hasChildUnits',
      [{ id, childCount: activeChildren.length }],
      { id, childCount: activeChildren.length },
    );
  }

  if (unitUsageCountDelegate) {
    const userCount = await unitUsageCountDelegate(Number(id));
    if (userCount > 0) {
      throw new ConflictAppException('organizations.hasAssignedUsers', [{ id, userCount }], {
        id,
        userCount,
      });
    }
  }
  const beforeSnapshot = {
    id: entity.id,
    code: entity.code,
    name: entity.name,
    type: entity.type,
    parentId: entity.parentId,
    managerId: entity.managerId ?? null,
    status: entity.status,
  };
  await repository.repository.softDelete(id);
  await auditLogService?.record({
    module: 'organizations',
    feature: 'organization-unit-management',
    action: 'organization_unit.delete',
    resourceType: 'organization_unit',
    resourceId: id,
    beforeData: beforeSnapshot,
    afterData: { deleted: true },
    reason: 'Soft-deleted organization unit',
  });
  return { deleted: true, id };
}

export async function ensureActiveOrganizationUnitsExist(params: {
  ids: readonly number[];
  repository: OrganizationUnitRepository;
  mapper: OrganizationsMapper;
}): Promise<OrganizationUnitSummary[]> {
  const { ids, repository, mapper } = params;
  const uniqueIds = [...new Set(ids.map(Number))];
  if (uniqueIds.length === 0) return [];

  const entities = await repository.findByIds(uniqueIds);
  const foundMap = new Map(entities.map((e) => [Number(e.id), e]));

  const missingIds = uniqueIds.filter((id) => !foundMap.has(id));
  if (missingIds.length > 0) {
    throw new BadRequestAppException('organizations.invalidOrMissingUnits', [{ missingIds }]);
  }

  const inactiveIds = entities
    .filter((e) => Number(e.status) !== ORG_UNIT_STATUS.ACTIVE)
    .map((e) => Number(e.id));
  if (inactiveIds.length > 0) {
    throw new BadRequestAppException('organizations.inactiveUnitsNotAllowed', [{ inactiveIds }]);
  }

  return entities.map((item) => mapper.toSummary(item));
}
