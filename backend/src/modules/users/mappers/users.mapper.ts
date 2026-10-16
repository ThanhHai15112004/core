import { Injectable } from '@nestjs/common';
import type { EntityMapperContract } from '@packages/database/index.js';
import {
  USER_STATUS,
  type UserOrganizationAssignmentSummary,
  type UserProfileView,
  type UserRoleAssignmentSummary,
  getUserStatusName,
  parseUserStatus,
} from '../contracts/index.js';
import type { UserEntity } from '../entities/user.entity.js';
import type { UserProfileEntity } from '../entities/user-profile.entity.js';
import type { UserResponse } from '../responses/users.response.js';

export interface UserRelationsContext {
  readonly profile?: UserProfileEntity | null | undefined;
  readonly roles?: readonly UserRoleAssignmentSummary[] | undefined;
  readonly organizationUnits?: readonly UserOrganizationAssignmentSummary[] | undefined;
  readonly decryptedPhone?: string | null | undefined;
}

@Injectable()
export class UsersMapper implements EntityMapperContract<UserEntity, UserResponse> {
  /** Chuyển đổi từ UserEntity (bảng Core) + UserProfileEntity (bảng chi tiết) sang UserResponse DTO */
  public toResponse(entity: UserEntity, context: UserRelationsContext = {}): UserResponse {
    const rawStatus = parseUserStatus(entity.status);
    const isArchived = Boolean(
      entity.deletedAt || entity.archivedAt || rawStatus === USER_STATUS.ARCHIVED,
    );
    const statusCode = isArchived ? USER_STATUS.ARCHIVED : rawStatus;

    const legacyEntity = entity as unknown as {
      firstName?: string;
      lastName?: string;
      fullName?: string;
      avatarUrl?: string | null;
    };
    const p = context.profile;
    const firstName = p?.firstName ?? legacyEntity.firstName ?? '';
    const lastName = p?.lastName ?? legacyEntity.lastName ?? '';
    const fullName =
      p?.fullName ?? (legacyEntity.fullName || `${lastName} ${firstName}`.trim() || entity.username);
    const avatarUrl = p?.avatarUrl ?? legacyEntity.avatarUrl ?? null;

    const profileView: UserProfileView = {
      firstName,
      lastName,
      fullName,
      avatarUrl,
      dateOfBirth: p?.dateOfBirth ?? null,
      gender: p?.gender ?? null,
      identityNumber: p?.identityNumber ?? null,
      address: p?.address ?? null,
      city: p?.city ?? null,
      country: p?.country ?? null,
      bio: p?.bio ?? null,
    };

    return {
      id: Number(entity.id),
      username: entity.username,
      email: entity.email ?? '',
      phone: context.decryptedPhone !== undefined ? context.decryptedPhone : (entity.phone ?? null),
      firstName,
      lastName,
      fullName,
      avatarUrl,
      profile: profileView,
      status: statusCode,
      statusName: getUserStatusName(statusCode),
      emailVerifiedAt: entity.emailVerifiedAt ? entity.emailVerifiedAt.toISOString() : null,
      phoneVerifiedAt: entity.phoneVerifiedAt ? entity.phoneVerifiedAt.toISOString() : null,
      lockedUntil: entity.lockedUntil ? entity.lockedUntil.toISOString() : null,
      lockReason: entity.lockReason ?? null,
      failedLoginAttempts: entity.failedLoginAttempts ?? 0,
      mfaEnabled: Boolean(entity.mfaEnabled),
      primaryOrganizationUnitId:
        entity.primaryOrganizationUnitId !== undefined && entity.primaryOrganizationUnitId !== null
          ? Number(entity.primaryOrganizationUnitId)
          : null,
      roles: context.roles ?? [],
      organizationUnits: context.organizationUnits ?? [],
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

  /** Chuyển đổi danh sách UserEntity sang danh sách UserResponse */
  public toResponseList(entities: UserEntity[]): UserResponse[] {
    return entities.map((item) => this.toResponse(item));
  }
}
