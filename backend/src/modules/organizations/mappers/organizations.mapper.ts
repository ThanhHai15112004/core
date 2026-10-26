import { Injectable } from '@nestjs/common';
import type { EntityMapperContract } from '@packages/database/index.js';
import {
  type OrganizationUnitSummary,
  getOrgUnitStatusName,
  getOrgUnitTypeName,
  parseOrgUnitStatus,
  parseOrgUnitType,
} from '../contracts/index.js';
import type { OrganizationUnitEntity } from '../entities/organization-unit.entity.js';
import type { OrganizationUnitResponse } from '../responses/organizations.response.js';

@Injectable()
export class OrganizationsMapper implements EntityMapperContract<
  OrganizationUnitEntity,
  OrganizationUnitResponse
> {
  /** Chuyển đổi từ OrganizationUnitEntity sang DTO trả về cho HTTP API */
  public toResponse(
    entity: OrganizationUnitEntity,
    managerName?: string | null,
  ): OrganizationUnitResponse {
    const typeCode = parseOrgUnitType(entity.type);
    const statusCode = parseOrgUnitStatus(entity.status);
    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      type: typeCode,
      typeName: getOrgUnitTypeName(typeCode),
      parentId:
        entity.parentId !== undefined && entity.parentId !== null ? Number(entity.parentId) : null,
      managerId:
        entity.managerId !== undefined && entity.managerId !== null
          ? Number(entity.managerId)
          : null,
      managerName: managerName ?? null,
      status: statusCode,
      statusName: getOrgUnitStatusName(statusCode),
      description: entity.description ?? null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /** Chuyển đổi danh sách OrganizationUnitEntity sang danh sách Response DTO */
  public toResponseList(
    entities: OrganizationUnitEntity[],
    managerNameById?: ReadonlyMap<number, string>,
  ): OrganizationUnitResponse[] {
    return entities.map((item) => {
      const mId =
        item.managerId !== undefined && item.managerId !== null ? Number(item.managerId) : null;
      const managerName = mId !== null ? (managerNameById?.get(mId) ?? null) : null;
      return this.toResponse(item, managerName);
    });
  }

  /** Chuyển đổi sang bản tóm tắt phục vụ giao tiếp liên module */
  public toSummary(entity: OrganizationUnitEntity): OrganizationUnitSummary {
    const typeCode = parseOrgUnitType(entity.type);
    const statusCode = parseOrgUnitStatus(entity.status);
    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      type: typeCode,
      typeName: getOrgUnitTypeName(typeCode),
      parentId:
        entity.parentId !== undefined && entity.parentId !== null ? Number(entity.parentId) : null,
      managerId:
        entity.managerId !== undefined && entity.managerId !== null
          ? Number(entity.managerId)
          : null,
      status: statusCode,
      statusName: getOrgUnitStatusName(statusCode),
    };
  }
}
