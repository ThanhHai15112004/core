import {
  BadRequestAppException,
  ConflictAppException,
  HTTP_ERROR_CODE,
} from '@packages/kernel/index.js';
import type { PasswordHasherService } from '@packages/security/index.js';
import type {
  IOrganizationsPublicService,
  OrganizationUnitSummary,
} from '@modules/organizations/contracts/index.js';
import type {
  IRolesPublicService,
  RoleAssignedUserSummary,
  RoleSummary,
} from '@modules/roles/contracts/index.js';
import type {
  UserNotificationContactView,
  UserOrganizationAssignmentSummary,
  UserProfileView,
  UserRoleAssignmentSummary,
} from '../contracts/index.js';
import { USER_STATUS } from '../enum/users.enum.js';
import type { PreparedCreateUserContext, PreparedUpdateUserFields } from '../types/users.types.js';
import {
  getUserStatusName,
  normalizePhoneNumber,
  parseUserStatus,
  resolveVietnameseNameParts,
} from './user-normalizer.helper.js';
import type { UserProfileEntity } from '../entities/user-profile.entity.js';
import type { UserEntity } from '../entities/user.entity.js';
import type { UsersMapper } from '../mappers/users.mapper.js';
import type { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import type { UserRoleRepository } from '../repositories/user-role.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { CreateUserRequest, UpdateUserRequest } from '../requests/users.requests.js';
import type { UserResponse } from '../responses/users.response.js';

export async function validateAndPrepareCreateUserContext(params: {
  dto: CreateUserRequest;
  userRepository: UserRepository;
  passwordHasher: PasswordHasherService;
  rolesPublicService: IRolesPublicService;
  organizationsPublicService: IOrganizationsPublicService | null;
}): Promise<PreparedCreateUserContext> {
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
}): Promise<PreparedUpdateUserFields> {
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

export async function filterActiveUserIds(
  userRepository: UserRepository,
  candidateIds: readonly number[],
): Promise<number[]> {
  const uniqueIds = [
    ...new Set(candidateIds.map(Number).filter((n) => Number.isFinite(n) && n >= 1)),
  ];
  if (uniqueIds.length === 0) return [];
  const activeIds: number[] = [];
  for (const uid of uniqueIds) {
    const u = await userRepository.findByIdWithArchived(uid, false);
    if (u && !u.deletedAt && !u.archivedAt && Number(u.status) === USER_STATUS.ACTIVE) {
      activeIds.push(Number(u.id));
    }
  }
  return activeIds;
}

export async function resolveActiveUserIdsByRoleIds(params: {
  roleIds: readonly number[];
  userRoleRepository: UserRoleRepository;
  userRepository: UserRepository;
}): Promise<number[]> {
  const { roleIds, userRoleRepository, userRepository } = params;
  if (roleIds.length === 0) return [];
  const links = await loadRoleLinks(userRoleRepository, roleIds);
  const candidateIds = links.map((l) => Number(l.userId));
  return filterActiveUserIds(userRepository, candidateIds);
}

export async function resolveActiveUserIdsByOrganizationUnitIds(params: {
  unitIds: readonly number[];
  userOrgRepository: UserOrganizationUnitRepository | null;
  userRepository: UserRepository;
}): Promise<number[]> {
  const { unitIds, userOrgRepository, userRepository } = params;
  const uniqueUnitIds = [
    ...new Set(unitIds.map(Number).filter((n) => Number.isFinite(n) && n >= 1)),
  ];
  if (uniqueUnitIds.length === 0) return [];

  const candidateIds = new Set<number>();
  if (userOrgRepository) {
    if (typeof userOrgRepository.findUserIdsByOrganizationUnitIds === 'function') {
      const fromOrgRepo = await userOrgRepository.findUserIdsByOrganizationUnitIds(uniqueUnitIds);
      for (const uid of fromOrgRepo) candidateIds.add(Number(uid));
    }
  }
  return filterActiveUserIds(userRepository, [...candidateIds]);
}

export async function resolveUserNotificationContacts(params: {
  userIds: readonly number[];
  userRepository: UserRepository;
  findProfilesByUserIds: (userIds: readonly number[]) => Promise<UserProfileEntity[]>;
  decryptPhone: (phone?: string | null) => string | null;
}): Promise<UserNotificationContactView[]> {
  const { userIds, userRepository, findProfilesByUserIds, decryptPhone } = params;
  const uniqueIds = [...new Set(userIds.map(Number).filter((n) => Number.isFinite(n) && n >= 1))];
  if (uniqueIds.length === 0) return [];

  const users: UserEntity[] = [];
  for (const uid of uniqueIds) {
    const u = await userRepository.findByIdWithArchived(uid, false);
    if (u && !u.deletedAt && !u.archivedAt) {
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
    const decryptedPhone = decryptPhone(u.phone);
    return {
      id: uid,
      username: u.username,
      email: u.email?.trim() || null,
      phone: decryptedPhone?.trim() || null,
      fullName:
        prof?.fullName || `${prof?.lastName ?? ''} ${prof?.firstName ?? ''}`.trim() || u.username,
      preferredLocale: prof?.preferredLocale || 'vi',
      preferredTimezone: prof?.preferredTimezone || 'Asia/Ho_Chi_Minh',
      primaryOrganizationUnitId:
        u.primaryOrganizationUnitId !== undefined && u.primaryOrganizationUnitId !== null
          ? Number(u.primaryOrganizationUnitId)
          : null,
    };
  });
}
