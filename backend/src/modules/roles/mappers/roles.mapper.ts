import { Injectable } from '@nestjs/common';
import type { RoleEntity } from '../entities/role.entity.js';
import type { RoleResponse } from '../responses/roles.response.js';
import type { RoleSummary } from '../contracts/index.js';

@Injectable()
export class RolesMapper {
  /** Chuyển đổi RoleEntity và danh sách quyền sang DTO phản hồi chi tiết */
  public toResponse(entity: RoleEntity, permissions: readonly string[] = []): RoleResponse {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      description: entity.description ?? null,
      isSystem: entity.isSystem,
      status: entity.status,
      permissions: [...permissions],
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /** Chuyển đổi RoleEntity và danh sách quyền sang bản tóm tắt phục vụ giao tiếp liên module */
  public toSummary(entity: RoleEntity, permissions: readonly string[] = []): RoleSummary {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      isSystem: entity.isSystem,
      status: entity.status,
      permissions: [...permissions],
    };
  }
}
