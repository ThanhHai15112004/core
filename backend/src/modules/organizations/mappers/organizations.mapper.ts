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
  public toResponse(entity: OrganizationUnitEntity): OrganizationUnitResponse {
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
      status: statusCode,
      statusName: getOrgUnitStatusName(statusCode),
      description: entity.description ?? null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /** Chuyển đổi danh sách OrganizationUnitEntity sang danh sách Response DTO */
  public toResponseList(entities: OrganizationUnitEntity[]): OrganizationUnitResponse[] {
    return entities.map((item) => this.toResponse(item));
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
      status: statusCode,
      statusName: getOrgUnitStatusName(statusCode),
    };
  }
}
