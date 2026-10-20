import {
  BadRequestAppException,
  ConflictAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import {
  LocaleContext,
  type SupportedLocale,
  isSupportedLocale,
  isValidIanaTimezone,
  resolveSystemDefaultLocale,
  resolveSystemDefaultTimezone,
} from '@packages/i18n/index.js';
import {
  type AuditLogService,
  DATA_SCOPE,
  type PasswordHasherService,
  type UserIdentity,
  parseDataScope,
} from '@packages/security/index.js';
import { type IRolesPublicService, ROLE_STATUS } from '@modules/roles/contracts/index.js';
import {
  type AdminResetUserMfaInput,
  type AdminResetUserMfaResult,
  type AdminResetUserPasswordInput,
  type AdminResetUserPasswordResult,
  type SelfRegisterUserInput,
  USER_STATUS,
  type UpdateUserPreferencesInput,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
  type UserPreferencesView,
  type UserProfileView,
  type UserStatusCode,
  getUserStatusName,
  normalizePhoneNumber,
  parseUserStatus,
  resolveVietnameseNameParts,
} from '../contracts/index.js';
import type { UserProfileEntity } from '../entities/user-profile.entity.js';
import type { UserEntity } from '../entities/user.entity.js';
import type { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import type { UserProfileRepository } from '../repositories/user-profile.repository.js';
import type { UserRoleRepository } from '../repositories/user-role.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';

export async function buildUserAuthCredentialsView(params: {
  user: UserEntity;
  getUserProfile: (userId: number, user?: UserEntity) => Promise<UserProfileView>;
  decryptPhone: (phone?: string | null) => string | null;
}): Promise<UserAuthCredentialsView> {
  const { user, getUserProfile, decryptPhone } = params;
  const profile = await getUserProfile(Number(user.id), user);
  const statusCode =
    user.deletedAt || user.archivedAt ? USER_STATUS.ARCHIVED : parseUserStatus(user.status);
  return {
    id: Number(user.id),
    username: user.username,
    email: user.email ?? '',
    phone: decryptPhone(user.phone),
    firstName: profile.firstName,
    lastName: profile.lastName,
    fullName: profile.fullName,
    passwordHash: user.passwordHash,
    passwordHistoryHashes: safeJsonParseStringArray(user.passwordHistoryHashesJson),
    status: statusCode,
    statusName: getUserStatusName(statusCode),
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    phoneVerifiedAt: user.phoneVerifiedAt ?? null,
    lockedUntil: user.lockedUntil ?? null,
    lockReason: user.lockReason ?? null,
    failedLoginAttempts: user.failedLoginAttempts ?? 0,
    mfaEnabled: Boolean(user.mfaEnabled),
    archivedAt: user.archivedAt ?? user.deletedAt ?? null,
  };
}

export async function buildUserAuthIdentityView(params: {
  userId: number;
  userRepository: UserRepository;
  userRoleRepository: UserRoleRepository;
  userOrgRepository: UserOrganizationUnitRepository;
  rolesPublicService: IRolesPublicService;
  getUserProfile: (userId: number, user?: UserEntity) => Promise<UserProfileView>;
  decryptPhone: (phone?: string | null) => string | null;
}): Promise<UserAuthIdentityView | null> {
  const {
    userId,
    userRepository,
    userRoleRepository,
    userOrgRepository,
    rolesPublicService,
    getUserProfile,
    decryptPhone,
  } = params;

  const user = await userRepository.findByIdWithArchived(userId, true);
  if (!user || user.deletedAt || user.archivedAt || Number(user.status) === USER_STATUS.ARCHIVED) {
    return null;
  }

  const [roleLinks, orgLinks, profile] = await Promise.all([
    userRoleRepository.findByUserIds([userId]),
    userOrgRepository.findByUserIds([userId]),
    getUserProfile(userId, user),
  ]);

  const roleIds = roleLinks.map((r) => Number(r.roleId));
  const roleSummaries = roleIds.length > 0 ? await rolesPublicService.findByIds(roleIds) : [];
  const activeRoles = roleSummaries.filter((r) => Number(r.status) === ROLE_STATUS.ACTIVE);

  const roleCodes = activeRoles.map((r) => r.code);
  const permissions = [...new Set(activeRoles.flatMap((r) => r.permissions))];
  const primaryOrgId =
    user.primaryOrganizationUnitId !== undefined && user.primaryOrganizationUnitId !== null
      ? Number(user.primaryOrganizationUnitId)
      : null;
  const organizationUnitIds = [
    ...new Set([
      ...(primaryOrgId ? [primaryOrgId] : []),
      ...orgLinks.map((o) => Number(o.organizationUnitId)),
    ]),
  ];
  const dataScopes =
    activeRoles.length > 0
      ? [...new Set(activeRoles.map((r) => parseDataScope(r.dataScope)))].sort((a, b) => a - b)
      : [DATA_SCOPE.SELF];
  const effectiveDataScope = dataScopes[0] ?? DATA_SCOPE.SELF;
  const statusCode = parseUserStatus(user.status);

  return {
    id: Number(user.id),
    username: user.username,
    email: user.email ?? '',
    firstName: profile.firstName,
    lastName: profile.lastName,
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl,
    phone: decryptPhone(user.phone),
    status: statusCode,
    statusName: getUserStatusName(statusCode),
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    phoneVerifiedAt: user.phoneVerifiedAt ?? null,
    lockedUntil: user.lockedUntil ?? null,
    mfaEnabled: Boolean(user.mfaEnabled),
    primaryOrganizationUnitId: primaryOrgId,
    managerId:
      user.managerId !== undefined && user.managerId !== null ? Number(user.managerId) : null,
    organizationUnitIds,
    roles: roleCodes.length > 0 ? roleCodes : ['user'],
    permissions,
    dataScope: effectiveDataScope,
    dataScopes,
    preferredLocale: profile.preferredLocale ?? resolveSystemDefaultLocale(),
    preferredTimezone: profile.preferredTimezone ?? resolveSystemDefaultTimezone(),
    profile,
  };
}

export async function executeSelfRegisterUser(params: {
  input: SelfRegisterUserInput;
  userRepository: UserRepository;
  passwordHasher: PasswordHasherService;
  encryptPhone: (phone?: string | null) => string | null;
  normalizePreferredLocale: (locale?: string | null) => SupportedLocale;
  normalizePreferredTimezone: (timezone?: string | null) => string;
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
  findAuthUserById: (userId: number) => Promise<UserAuthIdentityView | null>;
}): Promise<UserAuthIdentityView> {
  const {
    input,
    userRepository,
    passwordHasher,
    encryptPhone,
    normalizePreferredLocale,
    normalizePreferredTimezone,
    upsertUserProfile,
    recordStatusHistory,
    findAuthUserById,
  } = params;

  const normalizedEmail = input.email?.trim().toLowerCase() || null;
  const normalizedPhone = normalizePhoneNumber(input.phone);

  if (!normalizedEmail && !normalizedPhone) {
    throw new BadRequestAppException('auth.emailOrPhoneRequired');
  }

  const phoneHash = normalizedPhone ? passwordHasher.sha256(normalizedPhone) : null;
  const fallbackEmail =
    normalizedEmail ?? `${normalizedPhone ?? Date.now().toString(36)}@phone.local`;

  let baseUsername = input.username?.trim().toLowerCase() ?? '';
  if (!baseUsername || baseUsername.length < 3) {
    if (normalizedEmail) {
      baseUsername =
        (normalizedEmail.split('@')[0] ?? 'user').replace(/[^a-z0-9._-]/g, '') || 'user';
    } else if (normalizedPhone) {
      baseUsername = `u_${normalizedPhone.replace(/[^0-9]/g, '')}`;
    } else {
      baseUsername = 'user';
    }
  }
  if (baseUsername.length < 3) {
    baseUsername = `${baseUsername}_usr`;
  }

  const [existingByUsername, existingByEmail, existingByPhone] = await Promise.all([
    userRepository.findByUsername(baseUsername, true),
    userRepository.findByEmail(fallbackEmail, true),
    phoneHash && typeof userRepository.findByPhoneHash === 'function'
      ? userRepository.findByPhoneHash(phoneHash, true)
      : Promise.resolve(null),
  ]);

  if (existingByUsername && input.username) {
    throw new ConflictAppException(
      'users.duplicateUsername',
      [{ username: baseUsername }],
      { username: baseUsername },
      HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
    );
  }

  if (existingByEmail && normalizedEmail) {
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

  const finalUsername = existingByUsername
    ? `${baseUsername}_${Date.now().toString(36).slice(-4)}`
    : baseUsername;

  const nameParts = resolveVietnameseNameParts({
    firstName: input.firstName,
    lastName: input.lastName,
    fullName: input.fullName,
  });

  const passwordHash = await passwordHasher.hash(input.password);
  const encryptedPhone = encryptPhone(normalizedPhone ?? input.phone);
  const initialStatus = input.status ?? USER_STATUS.ACTIVE;

  const savedUser = await userRepository.saveEntity({
    username: finalUsername,
    email: fallbackEmail,
    phone: encryptedPhone,
    phoneHash,
    passwordHash,
    status: initialStatus,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    failedLoginAttempts: 0,
    mfaEnabled: false,
    primaryOrganizationUnitId: null,
    passwordChangedAt: new Date(),
  });

  const userId = Number(savedUser.id);
  const preferredLocale = normalizePreferredLocale(input.preferredLocale);
  const preferredTimezone = normalizePreferredTimezone(input.preferredTimezone);
  await upsertUserProfile(userId, {
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    fullName: nameParts.fullName,
    avatarUrl: input.avatarUrl ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    gender: input.gender ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    country: input.country ?? null,
    bio: input.bio ?? null,
    preferredLocale,
    preferredTimezone,
  });

  await recordStatusHistory(userId, null, initialStatus, 'Self-registered account', userId);

  const identity = await findAuthUserById(userId);
  return identity!;
}

export async function resolveUserPreferencesView(params: {
  userId: number;
  userRepository: UserRepository;
  userProfileRepository: UserProfileRepository | null;
}): Promise<UserPreferencesView> {
  const { userId, userRepository, userProfileRepository } = params;
  const user = await userRepository.findByIdWithArchived(userId, false);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id: userId });
  }
  const profileEntity = userProfileRepository
    ? await userProfileRepository.findByUserId(userId)
    : null;
  const preferredLocale = isSupportedLocale(profileEntity?.preferredLocale)
    ? profileEntity!.preferredLocale
    : resolveSystemDefaultLocale();
  const preferredTimezone = isValidIanaTimezone(profileEntity?.preferredTimezone)
    ? profileEntity!.preferredTimezone.trim()
    : resolveSystemDefaultTimezone();

  return {
    userId: Number(user.id),
    preferredLocale,
    preferredTimezone,
    updatedAt: (profileEntity?.updatedAt ?? user.updatedAt ?? new Date()).toISOString(),
  };
}

export async function updateUserPreferencesRecord(params: {
  userId: number;
  input: UpdateUserPreferencesInput;
  userRepository: UserRepository;
  getUserProfile: (userId: number, user?: UserEntity) => Promise<UserProfileView>;
  normalizePreferredLocale: (locale?: string | null) => SupportedLocale;
  normalizePreferredTimezone: (timezone?: string | null) => string;
  upsertUserProfile: (
    userId: number,
    data: Partial<UserProfileEntity>,
  ) => Promise<UserProfileEntity>;
  invalidateIdentityCache: (userId: number) => Promise<void>;
  auditLogService: AuditLogService | null;
}): Promise<UserPreferencesView> {
  const {
    userId,
    input,
    userRepository,
    getUserProfile,
    normalizePreferredLocale,
    normalizePreferredTimezone,
    upsertUserProfile,
    invalidateIdentityCache,
    auditLogService,
  } = params;

  const user = await userRepository.findByIdWithArchived(userId, false);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id: userId });
  }

  const currentProfile = await getUserProfile(userId, user);
  const nextLocale: SupportedLocale =
    input.preferredLocale !== undefined
      ? normalizePreferredLocale(input.preferredLocale)
      : isSupportedLocale(currentProfile.preferredLocale)
        ? currentProfile.preferredLocale
        : resolveSystemDefaultLocale();

  const nextTimezone: string =
    input.preferredTimezone !== undefined
      ? normalizePreferredTimezone(input.preferredTimezone)
      : isValidIanaTimezone(currentProfile.preferredTimezone)
        ? currentProfile.preferredTimezone!.trim()
        : resolveSystemDefaultTimezone();

  const savedProfile = await upsertUserProfile(userId, {
    firstName: currentProfile.firstName || user.username,
    lastName: currentProfile.lastName || '',
    fullName: currentProfile.fullName || user.username,
    avatarUrl: currentProfile.avatarUrl ?? null,
    dateOfBirth: currentProfile.dateOfBirth ?? null,
    gender: currentProfile.gender ?? null,
    identityNumber: currentProfile.identityNumber ?? null,
    address: currentProfile.address ?? null,
    city: currentProfile.city ?? null,
    country: currentProfile.country ?? null,
    bio: currentProfile.bio ?? null,
    preferredLocale: nextLocale,
    preferredTimezone: nextTimezone,
  });

  LocaleContext.applyUserPreferences({
    preferredLocale: nextLocale,
    preferredTimezone: nextTimezone,
  });

  await invalidateIdentityCache(userId);
  await auditLogService?.record({
    actorUserId: userId,
    module: 'users',
    feature: 'user-preferences',
    action: 'user.update_preferences',
    resourceType: 'user_profile',
    resourceId: userId,
    beforeData: {
      preferredLocale: currentProfile.preferredLocale ?? resolveSystemDefaultLocale(),
      preferredTimezone: currentProfile.preferredTimezone ?? resolveSystemDefaultTimezone(),
    },
    afterData: {
      preferredLocale: nextLocale,
      preferredTimezone: nextTimezone,
    },
    reason: 'Updated user locale and timezone preferences',
  });

  return {
    userId: Number(user.id),
    preferredLocale: nextLocale,
    preferredTimezone: nextTimezone,
    updatedAt: (savedProfile.updatedAt ?? new Date()).toISOString(),
  };
}

export async function markUserChannelVerified(params: {
  userId: number;
  channel: 'EMAIL' | 'PHONE';
  userRepository: UserRepository;
  recordStatusHistory: (
    userId: number,
    fromStatus: UserStatusCode | null,
    toStatus: UserStatusCode,
    reason?: string | null,
    changedBy?: number | null,
  ) => Promise<void>;
  invalidateIdentityCache: (userId: number) => Promise<void>;
}): Promise<void> {
  const { userId, channel, userRepository, recordStatusHistory, invalidateIdentityCache } = params;
  const user = await userRepository.findByIdWithArchived(userId, false);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id: userId });
  }
  if (channel === 'EMAIL') {
    user.emailVerifiedAt = new Date();
  } else {
    user.phoneVerifiedAt = new Date();
  }
  if (Number(user.status) === USER_STATUS.INACTIVE) {
    const prev = parseUserStatus(user.status);
    user.status = USER_STATUS.ACTIVE;
    await recordStatusHistory(
      userId,
      prev,
      USER_STATUS.ACTIVE,
      channel === 'EMAIL'
        ? 'Activated after email verification'
        : 'Activated after phone OTP verification',
      userId,
    );
  }
  await userRepository.saveEntity(user);
  await invalidateIdentityCache(userId);
}

export async function recordUserLoginAttemptState(params: {
  userId: number;
  outcome: 'SUCCESS' | 'FAILURE' | 'AUTO_UNLOCK';
  maxAttempts?: number;
  lockDurationMinutes?: number;
  userRepository: UserRepository;
  recordStatusHistory: (
    userId: number,
    fromStatus: UserStatusCode | null,
    toStatus: UserStatusCode,
    reason?: string | null,
    changedBy?: number | null,
  ) => Promise<void>;
  invalidateIdentityCache: (userId: number) => Promise<void>;
}): Promise<{ failedAttempts: number; locked: boolean; lockedUntil: Date | null }> {
  const {
    userId,
    outcome,
    maxAttempts = 5,
    lockDurationMinutes = 15,
    userRepository,
    recordStatusHistory,
    invalidateIdentityCache,
  } = params;

  const user = await userRepository.findByIdWithArchived(userId, false);
  if (!user) {
    return { failedAttempts: 0, locked: false, lockedUntil: null };
  }

  const prevStatus = parseUserStatus(user.status);

  if (outcome === 'SUCCESS') {
    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    if (
      prevStatus === USER_STATUS.LOCKED &&
      user.lockedUntil &&
      user.lockedUntil.getTime() <= Date.now()
    ) {
      user.status = USER_STATUS.ACTIVE;
      user.lockedUntil = null;
      user.lockReason = null;
      await recordStatusHistory(
        userId,
        prevStatus,
        USER_STATUS.ACTIVE,
        'Auto-unlocked after lock expiration',
      );
    }
    await userRepository.saveEntity(user);
    await invalidateIdentityCache(userId);
    return { failedAttempts: 0, locked: false, lockedUntil: null };
  }

  if (outcome === 'AUTO_UNLOCK') {
    if (prevStatus !== USER_STATUS.LOCKED) {
      if (user.failedLoginAttempts > 0) {
        user.failedLoginAttempts = 0;
        await userRepository.saveEntity(user);
      }
      return { failedAttempts: 0, locked: false, lockedUntil: null };
    }
    user.status = USER_STATUS.ACTIVE;
    user.lockedUntil = null;
    user.lockReason = null;
    user.failedLoginAttempts = 0;
    await userRepository.saveEntity(user);
    await recordStatusHistory(
      userId,
      prevStatus,
      USER_STATUS.ACTIVE,
      'Auto-unlocked after lock expiration',
    );
    await invalidateIdentityCache(userId);
    return { failedAttempts: 0, locked: false, lockedUntil: null };
  }

  user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
  let locked = false;
  let lockedUntil: Date | null = user.lockedUntil ?? null;

  if (user.failedLoginAttempts >= maxAttempts) {
    locked = true;
    lockedUntil = new Date(Date.now() + lockDurationMinutes * 60_000);
    user.status = USER_STATUS.LOCKED;
    user.lockedUntil = lockedUntil;
    user.lockReason = `Locked automatically after ${user.failedLoginAttempts} failed login attempts`;
  }

  await userRepository.saveEntity(user);
  if (locked && prevStatus !== USER_STATUS.LOCKED) {
    await recordStatusHistory(userId, prevStatus, USER_STATUS.LOCKED, user.lockReason);
  }
  await invalidateIdentityCache(userId);

  return {
    failedAttempts: user.failedLoginAttempts,
    locked,
    lockedUntil,
  };
}

export async function executeAdminResetUserMfaFlow(params: {
  id: number;
  dto: AdminResetUserMfaInput;
  actorId?: number | undefined;
  actor?: UserIdentity | undefined;
  userRepository: UserRepository;
  verifySensitiveActionStepUp: (
    actorId?: number,
    stepUpToken?: string,
    requireStepUp?: boolean,
    action?: string,
  ) => Promise<void>;
  ensureAccessUserRecord: (user: UserEntity, actor: UserIdentity, action: string) => Promise<void>;
  adminResetMfaDelegate?:
    | ((
        userId: number,
        input: AdminResetUserMfaInput,
        actorId?: number,
      ) => Promise<AdminResetUserMfaResult>)
    | undefined;
  adminRevokeSessionsDelegate?: ((userId: number, reason?: string) => Promise<number>) | undefined;
  invalidateIdentityCache: (userId: number) => Promise<void>;
}): Promise<AdminResetUserMfaResult> {
  const {
    id,
    dto,
    actorId,
    actor,
    userRepository,
    verifySensitiveActionStepUp,
    ensureAccessUserRecord,
    adminResetMfaDelegate,
    adminRevokeSessionsDelegate,
    invalidateIdentityCache,
  } = params;

  const reason = dto.reason?.trim();
  if (!reason || reason.length < 3) {
    throw new BadRequestAppException('auth.mfaResetReasonRequired');
  }

  if (dto.stepUpToken) {
    await verifySensitiveActionStepUp(actorId, dto.stepUpToken, true, 'users.resetMfa');
  }

  const user = await userRepository.findByIdWithArchived(id, true);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id });
  }
  if (actor) {
    await ensureAccessUserRecord(user, actor, 'update');
  }

  if (adminResetMfaDelegate) {
    const result = await adminResetMfaDelegate(id, dto, actorId);
    await invalidateIdentityCache(id);
    return result;
  }

  user.mfaEnabled = false;
  await userRepository.saveEntity(user);
  const revokedSessionsCount =
    dto.revokeSessions !== false && adminRevokeSessionsDelegate
      ? await adminRevokeSessionsDelegate(id, `MFA reset by administrator: ${reason}`)
      : 0;
  await invalidateIdentityCache(id);

  return {
    reset: true,
    userId: Number(id),
    revokedSessionsCount,
    revokedTrustedDevicesCount: 0,
    reason,
    verificationReference: dto.verificationReference ?? null,
    resetByActorId: actorId ?? null,
    resetAt: new Date().toISOString(),
  };
}

export async function executeAdminResetUserPasswordFlow(params: {
  id: number;
  dto: AdminResetUserPasswordInput;
  actorId?: number | undefined;
  actor?: UserIdentity | undefined;
  userRepository: UserRepository;
  passwordHasher: PasswordHasherService;
  ensureAccessUserRecord: (user: UserEntity, actor: UserIdentity, action: string) => Promise<void>;
  adminPasswordResetDelegate?:
    | ((
        userId: number,
        input: AdminResetUserPasswordInput,
        actorId?: number,
      ) => Promise<AdminResetUserPasswordResult>)
    | undefined;
  updatePasswordHash: (userId: number, newHash: string) => Promise<void>;
  unlockUser: (id: number, actorId?: number) => Promise<unknown>;
}): Promise<AdminResetUserPasswordResult> {
  const {
    id,
    dto,
    actorId,
    actor,
    userRepository,
    passwordHasher,
    ensureAccessUserRecord,
    adminPasswordResetDelegate,
    updatePasswordHash,
    unlockUser,
  } = params;

  const user = await userRepository.findByIdWithArchived(id, false);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id });
  }
  if (actor) {
    await ensureAccessUserRecord(user, actor, 'update');
  }

  if (adminPasswordResetDelegate) {
    return adminPasswordResetDelegate(id, dto, actorId);
  }

  const useSuggested = Boolean(dto.useSuggestedPassword || !dto.newPassword?.trim());
  const plainPassword = useSuggested
    ? passwordHasher.generateSuggestedPassword()
    : dto.newPassword!.trim();
  const newHash = await passwordHasher.hash(plainPassword);
  await updatePasswordHash(id, newHash);
  if (Number(user.status) === USER_STATUS.LOCKED) {
    await unlockUser(id, actorId);
  } else if (user.failedLoginAttempts > 0) {
    user.failedLoginAttempts = 0;
    await userRepository.saveEntity(user);
  }

  return {
    reset: true,
    userId: Number(id),
    revokedSessionsCount: 0,
    ...(useSuggested ? { generatedPassword: plainPassword } : {}),
  };
}

export async function resolveUserProfileView(params: {
  userId: number;
  user?: UserEntity | undefined;
  userProfileRepository: UserProfileRepository | null;
}): Promise<UserProfileView> {
  const { userId, user, userProfileRepository } = params;
  if (!userProfileRepository) {
    throw new Error('UserProfileRepository is not initialized');
  }
  const profile = await userProfileRepository.findByUserId(userId);

  return {
    firstName: profile?.firstName ?? '',
    lastName: profile?.lastName ?? '',
    fullName:
      profile?.fullName ??
      (`${profile?.lastName ?? ''} ${profile?.firstName ?? ''}`.trim() || user?.username || ''),
    avatarUrl: profile?.avatarUrl ?? null,
    dateOfBirth: profile?.dateOfBirth ?? null,
    gender: profile?.gender ?? null,
    identityNumber: profile?.identityNumber ?? null,
    address: profile?.address ?? null,
    city: profile?.city ?? null,
    country: profile?.country ?? null,
    bio: profile?.bio ?? null,
    preferredLocale: profile?.preferredLocale?.trim() || resolveSystemDefaultLocale(),
    preferredTimezone: profile?.preferredTimezone?.trim() || resolveSystemDefaultTimezone(),
  };
}

export async function executeUpdateUserPasswordHash(params: {
  userId: number;
  newPasswordHash: string;
  options?: { recordHistory?: boolean; maxHistory?: number } | undefined;
  userRepository: UserRepository;
  invalidateIdentityCache: (userId: number) => Promise<void>;
}): Promise<void> {
  const { userId, newPasswordHash, options, userRepository, invalidateIdentityCache } = params;
  const user = await userRepository.findByIdWithArchived(userId, false);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id: userId });
  }

  if (
    options?.recordHistory !== false &&
    user.passwordHash &&
    user.passwordHash !== newPasswordHash
  ) {
    const maxHistory = Math.max(1, Math.min(20, options?.maxHistory ?? 10));
    const currentHistory = safeJsonParseStringArray(user.passwordHistoryHashesJson);
    const nextHistory = [
      user.passwordHash,
      ...currentHistory.filter((h) => h !== user.passwordHash),
    ].slice(0, maxHistory);
    user.passwordHistoryHashesJson = JSON.stringify(nextHistory);
  }

  user.passwordHash = newPasswordHash;
  user.passwordChangedAt = new Date();
  await userRepository.saveEntity(user);
  await invalidateIdentityCache(userId);
}
