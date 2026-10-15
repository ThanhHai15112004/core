import { Injectable } from '@nestjs/common';
import type { UserEntity } from '../entities/user.entity.js';
import type {
  UserOrganizationAssignmentSummary,
  UserRoleAssignmentSummary,
} from '../contracts/index.js';
import type { UserResponse } from '../responses/users.response.js';

@Injectable()
export class UsersMapper {
  /** Chuyển đổi UserEntity cùng danh sách vai trò và đơn vị sang UserResponse DTO (loại bỏ passwordHash) */
  public toResponse(
    entity: UserEntity,
    roles: readonly UserRoleAssignmentSummary[] = [],
    organizationUnits: readonly UserOrganizationAssignmentSummary[] = [],
  ): UserResponse {
    const isArchived = Boolean(entity.deletedAt || entity.archivedAt);
    return {
      id: entity.id,
      username: entity.username,
      email: entity.email,
      phone: entity.phone ?? null,
      fullName: entity.fullName,
      avatarUrl: entity.avatarUrl ?? null,
      status: entity.status,
      lockedUntil: entity.lockedUntil ? entity.lockedUntil.toISOString() : null,
      lockReason: entity.lockReason ?? null,
      failedLoginAttempts: entity.failedLoginAttempts ?? 0,
      mfaEnabled: Boolean(entity.mfaEnabled),
      primaryOrganizationUnitId: entity.primaryOrganizationUnitId ?? null,
      roles: [...roles],
      organizationUnits: [...organizationUnits],
      lastLoginAt: entity.lastLoginAt ? entity.lastLoginAt.toISOString() : null,
      passwordChangedAt: entity.passwordChangedAt ? entity.passwordChangedAt.toISOString() : null,
      archivedAt: entity.archivedAt
        ? entity.archivedAt.toISOString()
        : entity.deletedAt
          ? entity.deletedAt.toISOString()
          : null,
      isArchived,
      version: entity.version ?? 1,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
