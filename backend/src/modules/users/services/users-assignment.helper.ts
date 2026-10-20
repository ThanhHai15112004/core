import {
  BadRequestAppException,
  ConflictAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  defaultCodeRegistry,
} from '@packages/kernel/index.js';
import type { TransactionManager } from '@packages/database/index.js';
import type {
  AuditLogService,
  PasswordHasherService,
  PlatformSecurityService,
  UserIdentity,
} from '@packages/security/index.js';
import type {
  IOrganizationsPublicService,
  OrganizationUnitSummary,
} from '@modules/organizations/contracts/index.js';
import type {
  IRolesPublicService,
  RoleAssignedUserSummary,
  RoleSummary,
} from '@modules/roles/contracts/index.js';
import {
  USER_STATUS,
  type UserOrganizationAssignmentSummary,
  type UserProfileView,
  type UserRoleAssignmentSummary,
  type UserStatusCode,
  getUserStatusName,
  normalizePhoneNumber,
  parseUserStatus,
  resolveVietnameseNameParts,
} from '../contracts/index.js';
import type { UserProfileEntity } from '../entities/user-profile.entity.js';
import type { UserEntity } from '../entities/user.entity.js';
import type { UsersMapper } from '../mappers/users.mapper.js';
import type { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import type { UserProfileRepository } from '../repositories/user-profile.repository.js';
import type { UserRoleRepository } from '../repositories/user-role.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type {
  AssignUserOrganizationsRequest,
  AssignUserRolesRequest,
  CreateUserRequest,
  UpdateUserRequest,
} from '../requests/users.requests.js';
import type { UserResponse } from '../responses/users.response.js';

export function registerUsersUsageCheckers(params: {
  userRepository: UserRepository;
  userProfileRepository: UserProfileRepository | null;
  userOrgRepository: UserOrganizationUnitRepository;
}): void {
  const { userRepository, userProfileRepository, userOrgRepository } = params;

  defaultCodeRegistry.registerUsageChecker(
    'users.status',
    'users.status',
    async ({ numericCode }) => {
      const { total } = await userRepository.searchPaginated({
        status: parseUserStatus(numericCode),
        includeArchived: true,
        page: 1,
        limit: 1,
      });
      return total;
    },
  );

  defaultCodeRegistry.registerUsageChecker(
    'users.gender',
    'user_profiles.gender',
    async ({ numericCode }) => {
      if (!userProfileRepository) return 0;
      const { items } = await userRepository.searchPaginated({
        includeArchived: true,
        page: 1,
        limit: 10000,
      });
      const userIds = items.filter((u) => !u.deletedAt).map((u) => Number(u.id));
      if (userIds.length === 0) return 0;
      const profiles = await userProfileRepository.findByUserIds(userIds);
      return profiles.filter((p) => Number(p.gender) === Number(numericCode)).length;
    },
  );

  defaultCodeRegistry.registerUsageChecker(
    'users.position_title',
    'user_organization_units.position_title',
    async ({ numericCode, code }) => {
      const { items } = await userRepository.searchPaginated({
        includeArchived: true,
        page: 1,
        limit: 10000,
      });
      const userIds = items.filter((u) => !u.deletedAt).map((u) => Number(u.id));
      if (userIds.length === 0) return 0;
      const assignments = await userOrgRepository.findByUserIds(userIds);
      const labelVi = defaultCodeRegistry.getLabel('users.position_title', numericCode, 'vi');
      const labelEn = defaultCodeRegistry.getLabel('users.position_title', numericCode, 'en');
      const candidates = new Set(
        [code, String(numericCode), labelVi, labelEn]
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      );
      return assignments.filter(
        (a) => a.positionTitle && candidates.has(a.positionTitle.trim().toUpperCase()),
      ).length;
    },
  );
}

export async function validateAndPrepareCreateUserContext(params: {
  dto: CreateUserRequest;
  userRepository: UserRepository;
  passwordHasher: PasswordHasherService;
  rolesPublicService: IRolesPublicService;
  organizationsPublicService: IOrganizationsPublicService | null;
}): Promise<{
  normalizedEmail: string;
  finalUsername: string;
  normalizedPhone: string | null;
  phoneHash: string | null;
  roleIds: number[];
  orgInputs: NonNullable<CreateUserRequest['organizationUnits']>;
}> {
  const { dto, userRepository, passwordHasher, rolesPublicService, organizationsPublicService } =
    params;

  const normalizedEmail = dto.email.trim().toLowerCase();
  const rawUsername =
    dto.username && dto.username.trim().length >= 3
      ? dto.username.trim().toLowerCase()
      : (normalizedEmail.split('@')[0] ?? 'user').replace(/[^a-z0-9._-]/g, '') || 'user';
  const normalizedUsername = rawUsername.length >= 3 ? rawUsername : `${rawUsername}_usr`;

  const normalizedPhone = normalizePhoneNumber(dto.phone);
  const phoneHash = normalizedPhone ? passwordHasher.sha256(normalizedPhone) : null;

  const [existingByUsername, existingByEmail, existingByPhone] = await Promise.all([
    userRepository.findByUsername(normalizedUsername, true),
    userRepository.findByEmail(normalizedEmail, true),
    phoneHash && typeof userRepository.findByPhoneHash === 'function'
      ? userRepository.findByPhoneHash(phoneHash, true)
      : Promise.resolve(null),
  ]);

  if (existingByUsername && dto.username) {
    throw new ConflictAppException(
      'users.duplicateUsername',
      [{ username: normalizedUsername }],
      { username: normalizedUsername },
      HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
    );
  }

  const finalUsername = existingByUsername
    ? `${normalizedUsername}_${Date.now().toString(36).slice(-4)}`
    : normalizedUsername;

  if (existingByEmail) {
    throw new ConflictAppException(
      'users.duplicateEmail',
      [{ email: normalizedEmail }],
      { email: normalizedEmail },
      HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
    );
  }

  if (existingByPhone && normalizedPhone) {
    throw new ConflictAppException(
      'users.duplicatePhone',
      [{ phone: normalizedPhone }],
      { phone: normalizedPhone },
      HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
    );
  }

  const roleIds = dto.roleIds ?? [];
  if (roleIds.length > 0) {
    await rolesPublicService.ensureActiveRolesExist(roleIds);
  }

  const orgInputs = dto.organizationUnits ?? [];
  if (orgInputs.length > 0 && organizationsPublicService) {
    await organizationsPublicService.ensureActiveUnitsExist(
      orgInputs.map((o) => o.organizationUnitId),
    );
  }

  if (dto.managerId !== undefined && dto.managerId !== null) {
    const manager = await userRepository.findByIdWithArchived(dto.managerId, false);
    if (!manager) {
      throw new BadRequestAppException('users.managerNotFound', [{ managerId: dto.managerId }]);
    }
  }

  return {
    normalizedEmail,
    finalUsername,
    normalizedPhone,
    phoneHash,
    roleIds,
    orgInputs,
  };
}

export async function validateAndApplyUserUpdateFields(params: {
  id: number;
  user: UserEntity;
  dto: UpdateUserRequest;
  currentProfile: UserProfileView;
  userRepository: UserRepository;
  passwordHasher: PasswordHasherService;
  encryptPhone: (phone?: string | null) => string | null;
  resolveSubordinateUserIds: (managerId: number) => Promise<number[]>;
}): Promise<{
  nextFirstName: string;
  nextLastName: string;
  nextFullName: string;
}> {
  const {
    id,
    user,
    dto,
    currentProfile,
    userRepository,
    passwordHasher,
    encryptPhone,
    resolveSubordinateUserIds,
  } = params;

  if (dto.managerId !== undefined) {
    if (dto.managerId === null) {
      user.managerId = null;
    } else {
      const nextManagerId = Number(dto.managerId);
      if (nextManagerId === Number(id)) {
        throw new BadRequestAppException('users.cannotBeOwnManager', [{ id }]);
      }
      const manager = await userRepository.findByIdWithArchived(nextManagerId, false);
      if (!manager) {
        throw new BadRequestAppException('users.managerNotFound', [{ managerId: nextManagerId }]);
      }
      const subordinates = await resolveSubordinateUserIds(Number(id));
      if (subordinates.includes(nextManagerId)) {
        throw new BadRequestAppException('users.circularManagerHierarchy', [
          { id, managerId: nextManagerId },
        ]);
      }
      user.managerId = nextManagerId;
    }
  }

  if (dto.email !== undefined) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    if (normalizedEmail !== user.email) {
      const duplicate = await userRepository.findByEmail(normalizedEmail, true);
      if (duplicate && Number(duplicate.id) !== Number(id)) {
        throw new ConflictAppException(
          'users.duplicateEmail',
          [{ email: normalizedEmail }],
          { email: normalizedEmail },
          HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
        );
      }
      user.email = normalizedEmail;
    }
  }

  if (dto.phone !== undefined) {
    const normalizedPhone = normalizePhoneNumber(dto.phone);
    const nextPhoneHash = normalizedPhone ? passwordHasher.sha256(normalizedPhone) : null;
    if (
      normalizedPhone &&
      nextPhoneHash &&
      nextPhoneHash !== user.phoneHash &&
      typeof userRepository.findByPhoneHash === 'function'
    ) {
      const duplicatePhone = await userRepository.findByPhoneHash(nextPhoneHash, true);
      if (duplicatePhone && Number(duplicatePhone.id) !== Number(id)) {
        throw new ConflictAppException(
          'users.duplicatePhone',
          [{ phone: normalizedPhone }],
          { phone: normalizedPhone },
          HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
        );
      }
    }
    user.phone = encryptPhone(normalizedPhone ?? dto.phone);
    user.phoneHash = nextPhoneHash;
  }

  let nextFirstName = currentProfile.firstName;
  let nextLastName = currentProfile.lastName;
  let nextFullName = currentProfile.fullName;

  if (dto.firstName !== undefined || dto.lastName !== undefined || dto.fullName !== undefined) {
    const resolved = resolveVietnameseNameParts({
      firstName: dto.firstName ?? currentProfile.firstName,
      lastName: dto.lastName ?? currentProfile.lastName,
      fullName:
        dto.fullName ??
        (dto.firstName !== undefined || dto.lastName !== undefined
          ? `${dto.lastName ?? currentProfile.lastName} ${dto.firstName ?? currentProfile.firstName}`.trim()
          : currentProfile.fullName),
    });
    nextFirstName = resolved.firstName;
    nextLastName = resolved.lastName;
    nextFullName = resolved.fullName;
  }

  return {
    nextFirstName,
    nextLastName,
    nextFullName,
  };
}

export async function hydrateUsersResponseList(params: {
  users: readonly UserEntity[];
  userRoleRepository: UserRoleRepository;
  userOrgRepository: UserOrganizationUnitRepository;
  findProfilesByUserIds: (userIds: readonly number[]) => Promise<UserProfileEntity[]>;
  rolesPublicService: IRolesPublicService;
  organizationsPublicService: IOrganizationsPublicService | null;
  mapper: UsersMapper;
  decryptPhone: (phone?: string | null) => string | null;
}): Promise<UserResponse[]> {
  const {
    users,
    userRoleRepository,
    userOrgRepository,
    findProfilesByUserIds,
    rolesPublicService,
    organizationsPublicService,
    mapper,
    decryptPhone,
  } = params;

  if (users.length === 0) return [];
  const userIds = users.map((u) => Number(u.id));

  const [allRoleLinks, allOrgLinks, allProfiles] = await Promise.all([
    userRoleRepository.findByUserIds(userIds),
    userOrgRepository.findByUserIds(userIds),
    findProfilesByUserIds(userIds),
  ]);

  const profileByUser = new Map<number, UserProfileEntity>();
  for (const p of allProfiles) {
    profileByUser.set(Number(p.userId), p);
  }

  const distinctRoleIds = [...new Set(allRoleLinks.map((l) => Number(l.roleId)))];
  const distinctOrgIds = [...new Set(allOrgLinks.map((l) => Number(l.organizationUnitId)))];

  const [roleSummaries, orgSummaries] = await Promise.all([
    distinctRoleIds.length > 0
      ? rolesPublicService.findByIds(distinctRoleIds)
      : Promise.resolve([] as RoleSummary[]),
    distinctOrgIds.length > 0 && organizationsPublicService
      ? organizationsPublicService.findByIds(distinctOrgIds)
      : Promise.resolve([] as OrganizationUnitSummary[]),
  ]);

  const roleMap = new Map(roleSummaries.map((r) => [Number(r.id), r]));
  const orgMap = new Map(orgSummaries.map((o) => [Number(o.id), o]));

  const rolesByUser = new Map<number, UserRoleAssignmentSummary[]>();
  for (const link of allRoleLinks) {
    const roleInfo = roleMap.get(Number(link.roleId));
    if (!roleInfo) continue;
    const uid = Number(link.userId);
    const list = rolesByUser.get(uid) ?? [];
    list.push({
      roleId: Number(roleInfo.id),
      code: roleInfo.code,
      name: roleInfo.name,
      ...(roleInfo.dataScope !== undefined ? { dataScope: roleInfo.dataScope } : {}),
      ...(roleInfo.dataScopeName !== undefined ? { dataScopeName: roleInfo.dataScopeName } : {}),
    });
    rolesByUser.set(uid, list);
  }

  const orgsByUser = new Map<number, UserOrganizationAssignmentSummary[]>();
  for (const link of allOrgLinks) {
    const orgInfo = orgMap.get(Number(link.organizationUnitId));
    const uid = Number(link.userId);
    const list = orgsByUser.get(uid) ?? [];
    list.push({
      organizationUnitId: Number(link.organizationUnitId),
      ...(orgInfo
        ? {
            code: orgInfo.code,
            name: orgInfo.name,
            type: orgInfo.type,
            typeName: orgInfo.typeName,
          }
        : {}),
      isPrimary: Boolean(link.isPrimary),
      positionTitle: link.positionTitle ?? null,
    });
    orgsByUser.set(uid, list);
  }

  return users.map((user) =>
    mapper.toResponse(user, {
      profile: profileByUser.get(Number(user.id)) ?? null,
      roles: rolesByUser.get(Number(user.id)) ?? [],
      organizationUnits: orgsByUser.get(Number(user.id)) ?? [],
      decryptedPhone: decryptPhone(user.phone),
    }),
  );
}

async function loadRoleLinks(userRoleRepository: UserRoleRepository, roleIds: readonly number[]) {
  if (typeof userRoleRepository.findByRoleIds === 'function') {
    return userRoleRepository.findByRoleIds(roleIds);
  }
  if (typeof userRoleRepository.findUserIdsByRoleIds === 'function') {
    const uids = await userRoleRepository.findUserIdsByRoleIds(roleIds);
    const allLinks = await userRoleRepository.findByUserIds(uids);
    const roleSet = new Set(roleIds.map(Number));
    return allLinks.filter((l) => roleSet.has(Number(l.roleId)));
  }
  return [];
}

export async function countActiveUsersByRoleIds(params: {
  roleIds: readonly number[];
  userRoleRepository: UserRoleRepository;
  userRepository: UserRepository;
}): Promise<Map<number, number>> {
  const { roleIds, userRoleRepository, userRepository } = params;
  const counts = new Map<number, number>();
  if (roleIds.length === 0) return counts;

  const links = await loadRoleLinks(userRoleRepository, roleIds);
  if (links.length === 0) return counts;

  const distinctUserIds = [...new Set(links.map((l) => Number(l.userId)))];
  const activeUserIds = new Set<number>();
  await Promise.all(
    distinctUserIds.map(async (uid) => {
      const u = await userRepository.findByIdWithArchived(uid, false);
      if (u && !u.deletedAt && !u.archivedAt && Number(u.status) !== USER_STATUS.ARCHIVED) {
        activeUserIds.add(uid);
      }
    }),
  );

  const seenPairs = new Set<string>();
  for (const link of links) {
    const uid = Number(link.userId);
    const rid = Number(link.roleId);
    if (!activeUserIds.has(uid)) continue;
    const key = `${rid}:${uid}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    counts.set(rid, (counts.get(rid) ?? 0) + 1);
  }
  return counts;
}

export async function listActiveUsersByRoleId(params: {
  roleId: number;
  userRoleRepository: UserRoleRepository;
  userRepository: UserRepository;
  findProfilesByUserIds: (userIds: readonly number[]) => Promise<UserProfileEntity[]>;
}): Promise<RoleAssignedUserSummary[]> {
  const { roleId, userRoleRepository, userRepository, findProfilesByUserIds } = params;
  const links = await loadRoleLinks(userRoleRepository, [roleId]);
  if (links.length === 0) return [];

  const assignedAtByUserId = new Map<number, Date>();
  for (const link of links) {
    const uid = Number(link.userId);
    if (!assignedAtByUserId.has(uid)) {
      assignedAtByUserId.set(uid, link.createdAt ?? new Date());
    }
  }

  const userIds = [...assignedAtByUserId.keys()];
  const users: UserEntity[] = [];
  for (const uid of userIds) {
    const u = await userRepository.findByIdWithArchived(uid, false);
    if (u && !u.deletedAt && !u.archivedAt && Number(u.status) !== USER_STATUS.ARCHIVED) {
      users.push(u);
    }
  }
  if (users.length === 0) return [];

  const profiles = await findProfilesByUserIds(users.map((u) => Number(u.id)));
  const profileMap = new Map<number, UserProfileEntity>();
  for (const p of profiles) {
    profileMap.set(Number(p.userId), p);
  }

  return users.map((u) => {
    const uid = Number(u.id);
    const prof = profileMap.get(uid);
    const statusCode = parseUserStatus(u.status);
    const assignedAt = assignedAtByUserId.get(uid) ?? u.createdAt ?? new Date();
    return {
      id: uid,
      username: u.username,
      email: u.email ?? '',
      fullName:
        prof?.fullName || `${prof?.lastName ?? ''} ${prof?.firstName ?? ''}`.trim() || u.username,
      status: statusCode,
      statusName: getUserStatusName(statusCode),
      primaryOrganizationUnitId:
        u.primaryOrganizationUnitId !== undefined && u.primaryOrganizationUnitId !== null
          ? Number(u.primaryOrganizationUnitId)
          : null,
      assignedAt: assignedAt.toISOString(),
    };
  });
}

export async function executeUserStatusTransition(params: {
  id: number;
  toStatus: UserStatusCode;
  action:
    | 'user.lock'
    | 'user.unlock'
    | 'user.deactivate'
    | 'user.activate'
    | 'user.archive'
    | 'user.restore';
  reason: string;
  actorId?: number | undefined;
  actor?: UserIdentity | undefined;
  lockedUntil?: Date | null | undefined;
  lockReason?: string | null | undefined;
  preserveLockReason?: boolean | undefined;
  archiveTimestamp?: Date | null | undefined;
  resetFailedAttempts?: boolean | undefined;
  userRepository: UserRepository;
  ensureAccessUserRecord: (user: UserEntity, actor: UserIdentity, action: string) => Promise<void>;
  recordStatusHistory: (
    userId: number,
    fromStatus: UserStatusCode | null,
    toStatus: UserStatusCode,
    reason?: string | null,
    changedBy?: number | null,
  ) => Promise<void>;
  invalidateIdentityCache: (userId: number) => Promise<void>;
  getById: (id: number, includeArchived: boolean) => Promise<UserResponse>;
  auditLogService: AuditLogService | null;
}): Promise<UserResponse> {
  const {
    id,
    toStatus,
    action,
    reason,
    actorId,
    actor,
    lockedUntil,
    lockReason,
    preserveLockReason,
    archiveTimestamp,
    resetFailedAttempts,
    userRepository,
    ensureAccessUserRecord,
    recordStatusHistory,
    invalidateIdentityCache,
    getById,
    auditLogService,
  } = params;

  const user = await userRepository.findByIdWithArchived(id, true);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id });
  }
  if (actor) {
    await ensureAccessUserRecord(user, actor, 'status');
  }

  const prevStatus = parseUserStatus(user.status);
  const prevLockReason = user.lockReason ?? null;

  user.status = toStatus;
  if (lockedUntil !== undefined) {
    user.lockedUntil = lockedUntil;
  }
  if (!preserveLockReason && lockReason !== undefined) {
    user.lockReason = lockReason;
  }
  if (resetFailedAttempts) {
    user.failedLoginAttempts = 0;
  }
  if (archiveTimestamp !== undefined) {
    user.archivedAt = archiveTimestamp;
    user.deletedAt = archiveTimestamp;
  }

  await userRepository.saveEntity(user);
  await recordStatusHistory(id, prevStatus, toStatus, reason, actorId);
  await invalidateIdentityCache(id);
  const updated = await getById(id, true);

  await auditLogService?.record({
    actorUserId: actorId ?? null,
    module: 'users',
    feature: 'user-status',
    action,
    resourceType: 'user',
    resourceId: id,
    beforeData: {
      status: prevStatus,
      ...(action === 'user.unlock' ? { lockReason: prevLockReason } : {}),
    },
    afterData: {
      status: toStatus,
      ...(action === 'user.lock'
        ? {
            lockReason: user.lockReason,
            lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
          }
        : {}),
      ...(action === 'user.unlock' ? { lockReason: null, failedLoginAttempts: 0 } : {}),
      ...(action === 'user.archive' && archiveTimestamp
        ? { archivedAt: archiveTimestamp.toISOString() }
        : {}),
      ...(action === 'user.restore' ? { archivedAt: null } : {}),
    },
    reason,
  });

  return updated;
}

export async function executeAssignUserRolesFlow(params: {
  id: number;
  dto: AssignUserRolesRequest;
  actorId?: number | undefined;
  actor?: UserIdentity | undefined;
  userRepository: UserRepository;
  userRoleRepository: UserRoleRepository;
  rolesPublicService: IRolesPublicService;
  verifySensitiveActionStepUp: (
    actorId?: number,
    stepUpToken?: string,
    requireStepUp?: boolean,
    action?: string,
  ) => Promise<void>;
  ensureAccessUserEntity: (user: UserEntity, actor: UserIdentity, action: string) => Promise<void>;
  invalidateIdentityCache: (userId: number) => Promise<void>;
  getById: (id: number) => Promise<UserResponse>;
  auditLogService: AuditLogService | null;
  platformSecurityService: PlatformSecurityService | null;
}): Promise<UserResponse> {
  const {
    id,
    dto,
    actorId,
    actor,
    userRepository,
    userRoleRepository,
    rolesPublicService,
    verifySensitiveActionStepUp,
    ensureAccessUserEntity,
    invalidateIdentityCache,
    getById,
    auditLogService,
    platformSecurityService,
  } = params;

  await verifySensitiveActionStepUp(
    actorId,
    dto.stepUpToken,
    dto.requireStepUp,
    'users.assignRoles',
  );
  const user = await userRepository.findByIdWithArchived(id, false);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id });
  }
  if (actor) {
    await ensureAccessUserEntity(user, actor, 'update');
  }

  const prevLinks = await userRoleRepository.findByUserIds([id]);
  const prevRoleIds = prevLinks.map((l) => Number(l.roleId));
  if (dto.roleIds.length > 0) {
    await rolesPublicService.ensureActiveRolesExist(dto.roleIds);
  }

  await userRoleRepository.replaceUserRoles(id, dto.roleIds, actorId);
  await invalidateIdentityCache(id);
  const updated = await getById(id);

  await auditLogService?.record({
    actorUserId: actorId ?? null,
    module: 'users',
    feature: 'user-roles',
    action: 'user.assign_roles',
    resourceType: 'user',
    resourceId: id,
    beforeData: { roleIds: prevRoleIds },
    afterData: {
      roleIds: updated.roles.map((r) => r.roleId),
      roleCodes: updated.roles.map((r) => r.code),
    },
    reason: 'Updated user roles assignment',
  });
  await platformSecurityService?.recordSecurityEvent({
    eventType: 'PERMISSION_CHANGED',
    module: 'users',
    feature: 'user-roles',
    action: 'user.assign_roles',
    actorId: actorId ?? null,
    targetUserId: id,
    resourceType: 'user',
    resourceId: id,
    reason: 'Updated user roles assignment',
    beforeData: { roleIds: prevRoleIds },
    afterData: {
      roleIds: updated.roles.map((r) => r.roleId),
      roleCodes: updated.roles.map((r) => r.code),
    },
    persistToAuditLog: false,
  });
  return updated;
}

export async function executeAssignUserOrganizationsFlow(params: {
  id: number;
  dto: AssignUserOrganizationsRequest;
  actorId?: number | undefined;
  actor?: UserIdentity | undefined;
  userRepository: UserRepository;
  userOrgRepository: UserOrganizationUnitRepository;
  organizationsPublicService: IOrganizationsPublicService | null;
  transactionManager: TransactionManager | null;
  ensureAccessUserEntity: (user: UserEntity, actor: UserIdentity, action: string) => Promise<void>;
  invalidateIdentityCache: (userId: number) => Promise<void>;
  getById: (id: number) => Promise<UserResponse>;
  auditLogService: AuditLogService | null;
}): Promise<UserResponse> {
  const {
    id,
    dto,
    actorId,
    actor,
    userRepository,
    userOrgRepository,
    organizationsPublicService,
    transactionManager,
    ensureAccessUserEntity,
    invalidateIdentityCache,
    getById,
    auditLogService,
  } = params;

  const user = await userRepository.findByIdWithArchived(id, false);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id });
  }
  if (actor) {
    await ensureAccessUserEntity(user, actor, 'update');
  }

  const prevLinks = await userOrgRepository.findByUserIds([id]);
  const prevOrgUnitIds = prevLinks.map((l) => Number(l.organizationUnitId));
  const unitIds = dto.organizationUnits.map((o) => o.organizationUnitId);
  if (unitIds.length > 0 && organizationsPublicService) {
    await organizationsPublicService.ensureActiveUnitsExist(unitIds);
  }

  const work = async (): Promise<void> => {
    const savedLinks = await userOrgRepository.replaceUserOrganizations(id, dto.organizationUnits);
    const primaryLink = savedLinks.find((l) => l.isPrimary) ?? savedLinks[0];
    user.primaryOrganizationUnitId = primaryLink ? Number(primaryLink.organizationUnitId) : null;
    await userRepository.saveEntity(user);
  };

  if (transactionManager) {
    await transactionManager.runInTransaction(work);
  } else {
    await work();
  }

  await invalidateIdentityCache(id);
  const updated = await getById(id);
  await auditLogService?.record({
    actorUserId: actorId ?? actor?.id ?? null,
    module: 'users',
    feature: 'user-organizations',
    action: 'user.assign_organizations',
    resourceType: 'user',
    resourceId: id,
    beforeData: { organizationUnitIds: prevOrgUnitIds },
    afterData: {
      organizationUnitIds: updated.organizationUnits.map((o) => o.organizationUnitId),
      primaryOrganizationUnitId: updated.primaryOrganizationUnitId,
    },
    reason: 'Updated user organization units assignment',
  });
  return updated;
}
