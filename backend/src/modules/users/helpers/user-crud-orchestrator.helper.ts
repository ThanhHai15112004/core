import {
  NotFoundAppException,
  type SearchDocumentInput,
  defaultSearchRegistry,
} from '@packages/kernel/index.js';
import { resolveSystemDefaultLocale, resolveSystemDefaultTimezone } from '@packages/i18n/index.js';
import type { TransactionManager } from '@packages/database/index.js';
import {
  type AuditLogService,
  type DataScopeService,
  type PasswordHasherService,
  type UserIdentity,
  parseDataScope,
} from '@packages/security/index.js';
import type { IOrganizationsPublicService } from '@modules/organizations/contracts/index.js';
import {
  type IRolesPublicService,
  ROLE_STATUS,
  type RoleAssignedUserSummary,
} from '@modules/roles/contracts/index.js';
import {
  USER_STATUS,
  USERS_AUDIT_META,
  type UserAuthCredentialsView,
  type UserNotificationContactView,
  type UserProfileView,
  type UserStatusCode,
  getUserStatusName,
  parseUserStatus,
  resolveVietnameseNameParts,
} from '../contracts/index.js';
import {
  normalizePreferredLocaleOrThrow,
  normalizePreferredTimezoneOrThrow,
  registerUsersUsageCheckers,
} from './user-normalizer.helper.js';
import {
  validateAndApplyUserUpdateFields,
  validateAndPrepareCreateUserContext,
} from './user-profile-hydration.helper.js';
import type { UserEntity } from '../entities/user.entity.js';
import type { UserProfileEntity } from '../entities/user-profile.entity.js';
import type { UserOrganizationHistoryRepository } from '../repositories/user-organization-history.repository.js';
import type { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import type { UserProfileRepository } from '../repositories/user-profile.repository.js';
import type { UserRoleRepository } from '../repositories/user-role.repository.js';
import type { UserStatusHistoryRepository } from '../repositories/user-status-history.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { CreateUserRequest, UpdateUserRequest } from '../requests/users.requests.js';
import type { UserResponse, UserStatusHistoryItemResponse } from '../responses/users.response.js';

export const USERS_SEARCH_ENTITY_CODE = 'users.account';

export function buildUserSearchDocument(
  user: UserResponse,
  overrides?: {
    readonly sourceUpdatedAt?: string | Date | undefined;
    readonly indexedAt?: string | Date | undefined;
  },
): SearchDocumentInput {
  const primaryOrgUnit =
    user.organizationUnits?.find((unit) => unit.isPrimary) ?? user.organizationUnits?.[0];
  const organizationUnitId =
    primaryOrgUnit?.organizationUnitId ?? user.primaryOrganizationUnitId ?? null;
  const roleCodes = (user.roles ?? []).map((role) => role.code);

  const keywords: string[] = [
    user.username,
    user.email,
    ...(user.employeeCode ? [user.employeeCode] : []),
    ...(user.phone ? [user.phone] : []),
    ...roleCodes,
  ];

  return {
    id: user.id,
    entityCode: USERS_SEARCH_ENTITY_CODE,
    module: 'users',
    entityType: 'user',
    title: user.fullName || user.username,
    subtitle: user.email,
    keywords,
    searchableText: [
      user.fullName,
      user.username,
      user.email,
      user.employeeCode ?? '',
      user.phone ?? '',
      primaryOrgUnit?.name ?? '',
    ]
      .filter((part) => Boolean(part))
      .join(' '),
    ownerId: user.id,
    organizationUnitId,
    status: user.status,
    metadata: {
      username: user.username,
      email: user.email,
      employeeCode: user.employeeCode ?? null,
      phone: user.phone ?? null,
      roles: roleCodes,
      organizationUnitId,
    },
    sourceUpdatedAt: overrides?.sourceUpdatedAt ?? user.updatedAt ?? user.createdAt,
    indexedAt: overrides?.indexedAt ?? new Date().toISOString(),
  };
}

export async function syncUserSearchDocumentSafe(
  user: UserResponse,
  actorId?: number,
): Promise<void> {
  try {
    await defaultSearchRegistry.syncDocuments([buildUserSearchDocument(user)], {
      actorId: actorId ?? null,
      executionMode: 'SYNC',
    });
  } catch {
    // Ignore search index sync errors during user CRUD
  }
}

export function registerUsersCrossModuleDelegates(params: {
  rolesPublicService: IRolesPublicService;
  organizationsPublicService: IOrganizationsPublicService | null;
  effectiveDataScopeService: DataScopeService;
  userRepository: UserRepository;
  userProfileRepository: UserProfileRepository | null;
  userOrgRepository: UserOrganizationUnitRepository;
  countUsersByRoleIds: (roleIds: readonly number[]) => Promise<Map<number, number>>;
  listUsersByRoleId: (roleId: number) => Promise<RoleAssignedUserSummary[]>;
  resolveSubordinateUserIds: (managerId: number) => Promise<number[]>;
  findAuthUserByIdentifier: (identifier: string) => Promise<UserAuthCredentialsView | null>;
  findUserContactsByIds: (userIds: readonly number[]) => Promise<UserNotificationContactView[]>;
}): void {
  const {
    rolesPublicService,
    organizationsPublicService,
    effectiveDataScopeService,
    userRepository,
    userProfileRepository,
    userOrgRepository,
    countUsersByRoleIds,
    listUsersByRoleId,
    resolveSubordinateUserIds,
    findAuthUserByIdentifier,
    findUserContactsByIds,
  } = params;

  rolesPublicService.registerRoleUserCountDelegate?.((roleIds) => countUsersByRoleIds(roleIds));
  rolesPublicService.registerRoleUsersListDelegate?.((roleId) => listUsersByRoleId(roleId));

  effectiveDataScopeService.registerSubordinateResolver((managerId) =>
    resolveSubordinateUserIds(managerId),
  );
  if (organizationsPublicService?.resolveDescendantUnitIds) {
    effectiveDataScopeService.registerOrgHierarchyResolver((unitIds) =>
      organizationsPublicService.resolveDescendantUnitIds!(unitIds),
    );
  }
  organizationsPublicService?.registerUnitUsageCountDelegate?.(async (unitId) => {
    const { total } = await userRepository.searchPaginated({
      organizationUnitId: unitId,
      includeArchived: false,
      page: 1,
      limit: 1,
    });
    return total;
  });
  organizationsPublicService?.registerUnitBatchUsageCountDelegate?.(async (unitIds) => {
    if (typeof userRepository.countUsersByOrganizationUnitIds === 'function') {
      return userRepository.countUsersByOrganizationUnitIds(unitIds);
    }
    let count = 0;
    for (const unitId of unitIds) {
      const { total } = await userRepository.searchPaginated({
        organizationUnitId: unitId,
        includeArchived: false,
        page: 1,
        limit: 1,
      });
      count += total;
    }
    return count;
  });
  organizationsPublicService?.registerUnitManagerResolverDelegate?.(
    async ({ userIds, identifiers }) => {
      const targetIds = new Set<number>(
        (userIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0),
      );
      if (identifiers && identifiers.length > 0) {
        for (const ident of identifiers) {
          const found = await findAuthUserByIdentifier(ident).catch(() => null);
          if (found) targetIds.add(Number(found.id));
        }
      }
      if (targetIds.size === 0) return [];
      const contacts = await findUserContactsByIds([...targetIds]);
      return contacts.map((c) => ({
        id: Number(c.id),
        username: c.username,
        fullName: c.fullName,
        email: c.email,
        status: USER_STATUS.ACTIVE,
      }));
    },
  );
  effectiveDataScopeService.registerRoleScopeResolver(async (roleCodes) => {
    const roles = await rolesPublicService.findByCodes(roleCodes);
    return roles
      .filter((r) => r.status === ROLE_STATUS.ACTIVE)
      .map((r) => parseDataScope(r.dataScope));
  });

  registerUsersUsageCheckers({
    userRepository,
    userProfileRepository,
    userOrgRepository,
  });
}

export async function executeGetStatusHistoryFlow(params: {
  userId: number;
  statusHistoryRepository: UserStatusHistoryRepository | null;
}): Promise<UserStatusHistoryItemResponse[]> {
  const { userId, statusHistoryRepository } = params;
  if (!statusHistoryRepository) {
    return [];
  }
  const rows = await statusHistoryRepository.findByUserId(userId);
  return rows.map((r) => {
    const fromCode =
      r.fromStatus !== undefined && r.fromStatus !== null ? parseUserStatus(r.fromStatus) : null;
    const toCode = parseUserStatus(r.toStatus);
    return {
      id: Number(r.id),
      userId: Number(r.userId),
      fromStatus: fromCode,
      fromStatusName: fromCode !== null ? getUserStatusName(fromCode) : null,
      toStatus: toCode,
      toStatusName: getUserStatusName(toCode),
      reason: r.reason ?? null,
      changedBy: r.changedBy !== undefined && r.changedBy !== null ? Number(r.changedBy) : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function executeCreateUserRecordFlow(params: {
  dto: CreateUserRequest;
  actorId?: number | undefined;
  userRepository: UserRepository;
  userRoleRepository: UserRoleRepository;
  userOrgRepository: UserOrganizationUnitRepository;
  orgHistoryRepository: UserOrganizationHistoryRepository | null;
  passwordHasher: PasswordHasherService;
  rolesPublicService: IRolesPublicService;
  organizationsPublicService: IOrganizationsPublicService | null;
  transactionManager: TransactionManager | null;
  auditLogService: AuditLogService | null;
  encryptPhone: (phone?: string | null) => string | null;
  upsertUserProfile: (
    userId: number,
    data: Partial<UserProfileEntity>,
  ) => Promise<UserProfileEntity>;
  recordStatusHistory: (
    userId: number,
    fromStatus: UserStatusCode | null,
    toStatus: UserStatusCode,
    reason?: string | null,
    changedBy?: number | null,
  ) => Promise<void>;
  getById: (id: number) => Promise<UserResponse>;
  syncUserSearchDocumentSafe: (user: UserResponse, actorId?: number) => Promise<void>;
}): Promise<UserResponse> {
  const {
    dto,
    actorId,
    userRepository,
    userRoleRepository,
    userOrgRepository,
    orgHistoryRepository,
    passwordHasher,
    rolesPublicService,
    organizationsPublicService,
    transactionManager,
    auditLogService,
    encryptPhone,
    upsertUserProfile,
    recordStatusHistory,
    getById,
    syncUserSearchDocumentSafe,
  } = params;

  const { normalizedEmail, finalUsername, normalizedPhone, phoneHash, roleIds, orgInputs } =
    await validateAndPrepareCreateUserContext({
      dto,
      userRepository,
      passwordHasher,
      rolesPublicService,
      organizationsPublicService,
    });

  const nameParts = resolveVietnameseNameParts({
    firstName: dto.firstName,
    lastName: dto.lastName,
    fullName: dto.fullName,
  });
  const passwordHash = await passwordHasher.hash(dto.password);
  const primaryOrgInput = orgInputs.find((o) => o.isPrimary) ?? orgInputs[0];
  const initialStatus = dto.status ?? USER_STATUS.ACTIVE;
  const encryptedPhone = encryptPhone(normalizedPhone ?? dto.phone);

  const work = async (): Promise<UserEntity> => {
    const savedUser = await userRepository.saveEntity({
      username: finalUsername,
      email: normalizedEmail,
      phone: encryptedPhone,
      phoneHash,
      passwordHash,
      status: initialStatus,
      failedLoginAttempts: 0,
      mfaEnabled: false,
      primaryOrganizationUnitId: primaryOrgInput?.organizationUnitId ?? null,
      managerId: dto.managerId ?? null,
      temporaryManagerId: dto.temporaryManagerId ?? null,
      temporaryManagerFrom:
        dto.temporaryManagerId && dto.temporaryManagerFrom
          ? new Date(dto.temporaryManagerFrom)
          : dto.temporaryManagerId
            ? new Date()
            : null,
      temporaryManagerUntil:
        dto.temporaryManagerId && dto.temporaryManagerUntil
          ? new Date(dto.temporaryManagerUntil)
          : null,
      passwordChangedAt: new Date(),
    });

    const userId = Number(savedUser.id);
    const preferredLocale = normalizePreferredLocaleOrThrow(dto.preferredLocale);
    const preferredTimezone = normalizePreferredTimezoneOrThrow(dto.preferredTimezone);
    await upsertUserProfile(userId, {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      fullName: nameParts.fullName,
      avatarUrl: dto.avatarUrl ?? null,
      dateOfBirth: dto.dateOfBirth ?? null,
      gender: dto.gender ?? null,
      identityNumber: dto.identityNumber ?? null,
      address: dto.address ?? null,
      city: dto.city ?? null,
      country: dto.country ?? null,
      bio: dto.bio ?? null,
      preferredLocale,
      preferredTimezone,
    });

    if (roleIds.length > 0) {
      await userRoleRepository.replaceUserRoles(userId, roleIds, actorId);
    }

    if (orgInputs.length > 0) {
      await userOrgRepository.replaceUserOrganizations(userId, orgInputs);
      if (orgHistoryRepository) {
        await orgHistoryRepository.recordHistories(
          orgInputs.map((o) => ({
            userId,
            organizationUnitId: Number(o.organizationUnitId),
            fromOrganizationUnitId: null,
            actionType: 'ASSIGN' as const,
            isPrimary: Boolean(o.isPrimary),
            positionTitle: o.positionTitle ?? null,
            startDate: o.startDate ? new Date(o.startDate) : new Date(),
            endDate: o.endDate ? new Date(o.endDate) : null,
            reason: 'Initial organization assignment',
            changedBy: actorId ?? null,
          })),
        );
      }
    }

    await recordStatusHistory(userId, null, initialStatus, 'Initial account creation', actorId);

    return savedUser;
  };

  const created = transactionManager
    ? await transactionManager.runInTransaction(work)
    : await work();

  const result = await getById(Number(created.id));
  await auditLogService?.record({
    actorUserId: actorId ?? null,
    module: USERS_AUDIT_META.MODULE,
    feature: USERS_AUDIT_META.FEATURES.MANAGEMENT,
    action: 'user.create',
    resourceType: USERS_AUDIT_META.RESOURCE_TYPES.USER,
    resourceId: result.id,
    beforeData: null,
    afterData: {
      id: result.id,
      username: result.username,
      email: result.email,
      status: result.status,
      roleCodes: result.roles.map((r) => r.code),
      organizationUnitIds: result.organizationUnits.map((o) => o.organizationUnitId),
    },
    reason: 'Initial account creation',
  });
  await syncUserSearchDocumentSafe(result, actorId);
  return result;
}

export async function executeUpdateUserRecordFlow(params: {
  id: number;
  dto: UpdateUserRequest;
  actorId?: number | undefined;
  actor?: UserIdentity | undefined;
  userRepository: UserRepository;
  passwordHasher: PasswordHasherService;
  transactionManager: TransactionManager | null;
  auditLogService: AuditLogService | null;
  ensureAccessUserEntity: (user: UserEntity, actor: UserIdentity, action: string) => Promise<void>;
  getUserProfile: (userId: number, user?: UserEntity) => Promise<UserProfileView>;
  encryptPhone: (phone?: string | null) => string | null;
  resolveSubordinateUserIds: (managerId: number) => Promise<number[]>;
  upsertUserProfile: (
    userId: number,
    data: Partial<UserProfileEntity>,
  ) => Promise<UserProfileEntity>;
  invalidateIdentityCache: (userId: number) => Promise<void>;
  getById: (id: number, includeArchived?: boolean) => Promise<UserResponse>;
  syncUserSearchDocumentSafe: (user: UserResponse, actorId?: number) => Promise<void>;
}): Promise<UserResponse> {
  const {
    id,
    dto,
    actorId,
    actor,
    userRepository,
    passwordHasher,
    transactionManager,
    auditLogService,
    ensureAccessUserEntity,
    getUserProfile,
    encryptPhone,
    resolveSubordinateUserIds,
    upsertUserProfile,
    invalidateIdentityCache,
    getById,
    syncUserSearchDocumentSafe,
  } = params;

  const user = await userRepository.findByIdWithArchived(id, true);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id });
  }
  if (actor) {
    await ensureAccessUserEntity(user, actor, 'update');
  }
  const beforeSnapshot = {
    id: user.id,
    username: user.username,
    email: user.email,
    managerId: user.managerId ?? null,
    temporaryManagerId: user.temporaryManagerId ?? null,
    temporaryManagerFrom: user.temporaryManagerFrom ?? null,
    temporaryManagerUntil: user.temporaryManagerUntil ?? null,
    status: user.status,
  };

  const currentProfile = await getUserProfile(id, user);
  const { nextFirstName, nextLastName, nextFullName } = await validateAndApplyUserUpdateFields({
    id,
    user,
    dto,
    currentProfile,
    userRepository,
    passwordHasher,
    encryptPhone,
    resolveSubordinateUserIds,
  });

  const nextPreferredLocale =
    dto.preferredLocale !== undefined
      ? normalizePreferredLocaleOrThrow(dto.preferredLocale)
      : (currentProfile.preferredLocale ?? resolveSystemDefaultLocale());
  const nextPreferredTimezone =
    dto.preferredTimezone !== undefined
      ? normalizePreferredTimezoneOrThrow(dto.preferredTimezone)
      : (currentProfile.preferredTimezone ?? resolveSystemDefaultTimezone());

  const persistChanges = async (): Promise<void> => {
    if (dto.expectedVersion !== undefined) {
      await userRepository.updateWithOptimisticLock(id, dto.expectedVersion, {
        email: user.email,
        phone: user.phone ?? null,
        phoneHash: user.phoneHash ?? null,
        managerId: user.managerId ?? null,
        temporaryManagerId: user.temporaryManagerId ?? null,
        temporaryManagerFrom: user.temporaryManagerFrom ?? null,
        temporaryManagerUntil: user.temporaryManagerUntil ?? null,
      });
    } else {
      await userRepository.saveEntity(user);
    }

    await upsertUserProfile(id, {
      firstName: nextFirstName,
      lastName: nextLastName,
      fullName: nextFullName,
      avatarUrl: dto.avatarUrl !== undefined ? dto.avatarUrl : (currentProfile.avatarUrl ?? null),
      dateOfBirth:
        dto.dateOfBirth !== undefined ? dto.dateOfBirth : (currentProfile.dateOfBirth ?? null),
      gender: dto.gender !== undefined ? dto.gender : (currentProfile.gender ?? null),
      identityNumber:
        dto.identityNumber !== undefined
          ? dto.identityNumber
          : (currentProfile.identityNumber ?? null),
      address: dto.address !== undefined ? dto.address : (currentProfile.address ?? null),
      city: dto.city !== undefined ? dto.city : (currentProfile.city ?? null),
      country: dto.country !== undefined ? dto.country : (currentProfile.country ?? null),
      bio: dto.bio !== undefined ? dto.bio : (currentProfile.bio ?? null),
      preferredLocale: nextPreferredLocale,
      preferredTimezone: nextPreferredTimezone,
    });
  };

  if (transactionManager) {
    await transactionManager.runInTransaction(persistChanges);
  } else {
    await persistChanges();
  }

  await invalidateIdentityCache(id);
  const updated = await getById(id, true);
  await auditLogService?.record({
    actorUserId: actorId ?? actor?.id ?? null,
    module: USERS_AUDIT_META.MODULE,
    feature: USERS_AUDIT_META.FEATURES.MANAGEMENT,
    action: 'user.update',
    resourceType: USERS_AUDIT_META.RESOURCE_TYPES.USER,
    resourceId: id,
    beforeData: {
      ...beforeSnapshot,
      fullName: currentProfile.fullName,
    },
    afterData: {
      id: updated.id,
      username: updated.username,
      email: updated.email,
      managerId: updated.managerId,
      temporaryManagerId: updated.temporaryManagerId,
      temporaryManagerFrom: updated.temporaryManagerFrom,
      temporaryManagerUntil: updated.temporaryManagerUntil,
      status: updated.status,
      fullName: updated.fullName,
    },
  });
  await syncUserSearchDocumentSafe(updated, actorId ?? actor?.id);
  return updated;
}
