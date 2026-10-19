import { Injectable } from '@nestjs/common';
import type { EntityMapperContract } from '@packages/database/index.js';
import { type RoleSummary, getRoleStatusName, parseRoleStatus } from '../contracts/index.js';
import type { PermissionEntity } from '../entities/permission.entity.js';
import type { RoleEntity } from '../entities/role.entity.js';
import type { RoleResponse } from '../responses/roles.response.js';

@Injectable()
export class RolesMapper implements EntityMapperContract<RoleEntity, RoleResponse> {
  /** Chuyển đổi từ RoleEntity kèm danh sách PermissionEntity sang RoleResponse DTO */
  public toResponse(
    entity: RoleEntity,
    permissions: readonly PermissionEntity[] = [],
    userCount = 0,
  ): RoleResponse {
    const statusCode = parseRoleStatus(entity.status);
    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      description: entity.description ?? null,
      isSystem: Boolean(entity.isSystem),
      status: statusCode,
      statusName: getRoleStatusName(statusCode),
      permissionIds: permissions.map((p) => Number(p.id)),
      permissions: permissions.map((p) => p.code),
      userCount: Math.max(0, Math.trunc(userCount)),
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /** Chuyển đổi danh sách RoleEntity sang danh sách RoleResponse */
  public toResponseList(entities: RoleEntity[]): RoleResponse[] {
    return entities.map((item) => this.toResponse(item));
  }

  /** Chuyển đổi sang bản tóm tắt phục vụ giao tiếp liên module */
  public toSummary(entity: RoleEntity, permissions: readonly PermissionEntity[] = []): RoleSummary {
    const statusCode = parseRoleStatus(entity.status);
    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      isSystem: Boolean(entity.isSystem),
      status: statusCode,
      statusName: getRoleStatusName(statusCode),
      permissionIds: permissions.map((p) => Number(p.id)),
      permissions: permissions.map((p) => p.code),
    };
  }
}
