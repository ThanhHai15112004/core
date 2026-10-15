import { Injectable } from '@nestjs/common';
import type { EntityMapperContract } from '@packages/database/index.js';
import type { OrganizationUnitEntity } from '../entities/organization-unit.entity.js';
import type { OrganizationUnitResponse } from '../responses/organizations.response.js';
import type { OrganizationUnitSummary } from '../contracts/index.js';

@Injectable()
export class OrganizationsMapper implements EntityMapperContract<
  OrganizationUnitEntity,
  OrganizationUnitResponse
> {
  /** Chuyển đổi thực thể ORM sang DTO phản hồi chi tiết */
  public toResponse(entity: OrganizationUnitEntity): OrganizationUnitResponse {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      type: entity.type,
      parentId: entity.parentId ?? null,
      status: entity.status,
      description: entity.description ?? null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /** Chuyển đổi danh sách thực thể ORM sang danh sách DTO phản hồi */
  public toResponseList(entities: OrganizationUnitEntity[]): OrganizationUnitResponse[] {
    return entities.map((item) => this.toResponse(item));
  }

  /** Chuyển đổi thực thể ORM sang bản tóm tắt phục vụ giao tiếp liên module */
  public toSummary(entity: OrganizationUnitEntity): OrganizationUnitSummary {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      type: entity.type,
      parentId: entity.parentId ?? null,
      status: entity.status,
    };
  }
}
