import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
  type PaginatedResult,
  defaultSettingRegistry,
  resolvePagination,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { resolveSystemDefaultLocale, resolveSystemDefaultTimezone } from '@packages/i18n/index.js';
import { TransactionManager } from '@packages/database/index.js';
import {
  AuditLogService,
  DataScopeService,
  FieldEncryptionService,
  PasswordHasherService,
  PlatformSecurityService,
  type ResolvedDataScopeFilter,
  type UserIdentity,
  createDefaultDataScopeService,
  parseDataScope,
} from '@packages/security/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import {
  type IRolesPublicService,
  ROLE_STATUS,
  ROLES_PUBLIC_SERVICE,
  type RoleAssignedUserSummary,
} from '@modules/roles/contracts/index.js';
import {
  type AdminResetUserMfaInput,
  type AdminResetUserMfaResult,
  type AdminResetUserPasswordInput,
  type AdminResetUserPasswordResult,
  type IUsersPublicService,
  type SelfRegisterUserInput,
  USER_IDENTITY_CACHE_PREFIX,
  USER_STATUS,
  USERS_AUDIT_META,
  USERS_SETTING_KEYS,
  type UpdateUserPreferencesInput,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
  type UserLoginHistoryItemView,
  type UserNotificationContactView,
  type UserPreferencesView,
  type UserProfileView,
  type UserStatusCode,
  getUserStatusName,
  normalizePhoneNumber,
  parseUserStatus,
  resolveVietnameseNameParts,
} from '../contracts/index.js';
import type { UserStatusTransitionAction } from '../types/users.types.js';
import {
  normalizePreferredLocaleOrThrow,
  normalizePreferredTimezoneOrThrow,
  registerUsersUsageCheckers,
} from '../helpers/user-normalizer.helper.js';
import {
  countActiveUsersByRoleIds,
  filterActiveUserIds,
  hydrateUsersResponseList,
  listActiveUsersByRoleId,
  resolveActiveUserIdsByOrganizationUnitIds,
  resolveActiveUserIdsByRoleIds,
  resolveUserNotificationContacts,
  validateAndApplyUserUpdateFields,
  validateAndPrepareCreateUserContext,
} from '../helpers/user-profile-hydration.helper.js';
import {
  executeAssignUserOrganizationsFlow,
  executeAssignUserRolesFlow,
  executeUserStatusTransition,
} from '../helpers/user-lifecycle-assignment.helper.js';
import {
  buildUserAuthCredentialsView,
  buildUserAuthIdentityView,
  executeAdminResetUserMfaFlow,
  executeAdminResetUserPasswordFlow,
  executeSelfRegisterUser,
  executeUpdateUserPasswordHash,
  markUserChannelVerified,
  recordUserLoginAttemptState,
  resolveUserPreferencesView,
  resolveUserProfileView,
  updateUserPreferencesRecord,
} from '../helpers/user-auth-bridge.helper.js';
import type { UserEntity } from '../entities/user.entity.js';
import type { UserProfileEntity } from '../entities/user-profile.entity.js';
import { UserRepository } from '../repositories/user.repository.js';
import { UserProfileRepository } from '../repositories/user-profile.repository.js';
import { UserRoleRepository } from '../repositories/user-role.repository.js';
import { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import { UserStatusHistoryRepository } from '../repositories/user-status-history.repository.js';
import { UsersMapper } from '../mappers/users.mapper.js';
import type {
  AssignUserOrganizationsRequest,
  AssignUserRolesRequest,
  ChangeUserStatusRequest,
  CreateUserRequest,
  ListUsersQuery,
  LockUserRequest,
  UpdateUserRequest,
} from '../requests/users.requests.js';
import type { UserResponse, UserStatusHistoryItemResponse } from '../responses/users.response.js';

export { USER_IDENTITY_CACHE_PREFIX };

@Injectable()
export class UsersService implements IUsersPublicService {
  private readonly effectiveDataScopeService: DataScopeService;
  private adminPasswordResetDelegate?: (
    userId: number,
    input: AdminResetUserPasswordInput,
    actorId?: number,
  ) => Promise<AdminResetUserPasswordResult>;
  private adminRevokeSessionsDelegate?: (userId: number, reason?: string) => Promise<number>;
  private userLoginHistoryDelegate?: (
    userId: number,
    limit?: number,
  ) => Promise<UserLoginHistoryItemView[]>;
  private adminResetMfaDelegate?: (
    userId: number,
    input: AdminResetUserMfaInput,
    actorId?: number,
  ) => Promise<AdminResetUserMfaResult>;
  private stepUpVerificationDelegate?: (
    userId: number,
    stepUpToken: string,
    action?: string,
  ) => Promise<boolean>;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly userRoleRepository: UserRoleRepository,
    private readonly userOrgRepository: UserOrganizationUnitRepository,
    private readonly mapper: UsersMapper,
    private readonly passwordHasher: PasswordHasherService,
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesPublicService: IRolesPublicService,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService: IOrganizationsPublicService | null = null,
    @Optional()
    @Inject(UserStatusHistoryRepository)
    private readonly statusHistoryRepository: UserStatusHistoryRepository | null = null,
    @Optional()
    @Inject(FieldEncryptionService)
    private readonly fieldEncryption: FieldEncryptionService | null = null,
    @Optional()
    @Inject(TransactionManager)
    private readonly transactionManager: TransactionManager | null = null,
    @Optional()
    @Inject(RedisService)
    private readonly redis: RedisService | null = null,
    @Optional()
    @Inject(UserProfileRepository)
    private readonly userProfileRepository: UserProfileRepository | null = null,
    @Optional()
    @Inject(DataScopeService)
    private readonly dataScopeService: DataScopeService | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
    @Optional()
    @Inject(PlatformSecurityService)
    private readonly platformSecurityService: PlatformSecurityService | null = null,
  ) {
    this.effectiveDataScopeService = this.dataScopeService ?? createDefaultDataScopeService();

    this.rolesPublicService.registerRoleUserCountDelegate?.((roleIds) =>
      this.countUsersByRoleIds(roleIds),
    );
    this.rolesPublicService.registerRoleUsersListDelegate?.((roleId) =>
      this.listUsersByRoleId(roleId),
    );

    this.effectiveDataScopeService.registerSubordinateResolver((managerId) =>
      this.resolveSubordinateUserIds(managerId),
    );
    if (this.organizationsPublicService?.resolveDescendantUnitIds) {
      this.effectiveDataScopeService.registerOrgHierarchyResolver((unitIds) =>
        this.organizationsPublicService!.resolveDescendantUnitIds!(unitIds),
      );
    }
    this.organizationsPublicService?.registerUnitUsageCountDelegate?.(async (unitId) => {
      const { total } = await this.userRepository.searchPaginated({
        organizationUnitId: unitId,
        includeArchived: false,
        page: 1,
        limit: 1,
      });
      return total;
    });
    this.organizationsPublicService?.registerUnitManagerResolverDelegate?.(
      async ({ userIds, identifiers }) => {
        const targetIds = new Set<number>(
          (userIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0),
        );
        if (identifiers && identifiers.length > 0) {
          for (const ident of identifiers) {
            const found = await this.findAuthUserByIdentifier(ident).catch(() => null);
            if (found) targetIds.add(Number(found.id));
          }
        }
        if (targetIds.size === 0) return [];
        const contacts = await this.findUserContactsByIds([...targetIds]);
        return contacts.map((c) => ({
          id: Number(c.id),
          username: c.username,
          fullName: c.fullName,
          email: c.email,
          status: USER_STATUS.ACTIVE,
        }));
      },
    );
    this.effectiveDataScopeService.registerRoleScopeResolver(async (roleCodes) => {
      const roles = await this.rolesPublicService.findByCodes(roleCodes);
      return roles
        .filter((r) => r.status === ROLE_STATUS.ACTIVE)
        .map((r) => parseDataScope(r.dataScope));
    });

    registerUsersUsageCheckers({
      userRepository: this.userRepository,
      userProfileRepository: this.userProfileRepository,
      userOrgRepository: this.userOrgRepository,
    });
  }

  public getDataScopeService(): DataScopeService {
    return this.effectiveDataScopeService;
  }

  public async resolveSubordinateUserIds(managerId: number): Promise<number[]> {
    if (typeof this.userRepository.findSubordinateUserIds === 'function') {
      return this.userRepository.findSubordinateUserIds(managerId);
    }
    return [];
  }

  public async resolveUserScopeFilter(
    actor?: UserIdentity,
    action = 'read',
  ): Promise<ResolvedDataScopeFilter | undefined> {
    if (!actor) return undefined;
    return this.effectiveDataScopeService.resolveScopeFilter(actor, 'users', action);
  }

  public async assertCanAccessUserRecord(
    targetUser: UserResponse,
    actor?: UserIdentity,
    action = 'read',
  ): Promise<void> {
    if (!actor) return;
    const orgIds = [
      ...(targetUser.primaryOrganizationUnitId ? [targetUser.primaryOrganizationUnitId] : []),
      ...targetUser.organizationUnits.map((o) => Number(o.organizationUnitId)),
    ];
    await this.effectiveDataScopeService.assertCanAccessRecord(
      actor,
      'users',
      {
        id: targetUser.id,
        ownerId: targetUser.id,
        primaryOrganizationUnitId: targetUser.primaryOrganizationUnitId,
        organizationUnitIds: [...new Set(orgIds)],
        managerId: targetUser.managerId ?? null,
      },
      action,
    );
  }

  public async listPaginated(
    query: ListUsersQuery,
    actor?: UserIdentity,
  ): Promise<PaginatedResult<UserResponse>> {
    const actorOrgUnitId = query.organizationUnitId ?? actor?.organizationUnitIds?.[0];
    const { page, limit, countMode } = resolvePagination(query, {
      settingPrefix: USERS_SETTING_KEYS.PAGINATION_PREFIX,
      defaultLimit: 20,
      maxLimit: 500,
      context: actorOrgUnitId ? { organizationUnitId: actorOrgUnitId } : undefined,
    });
    const scopeFilter = await this.resolveUserScopeFilter(actor, 'read');
    const { items, total } = await this.userRepository.searchPaginated({
      ...query,
      page,
      limit,
      countMode,
      ...(scopeFilter ? { scopeFilter } : {}),
    });
    const enriched = await this.hydrateUsersList(items);
    return createPaginatedResult(
      enriched,
      countMode === 'none' ? null : total,
      page,
      limit,
      query.fields ? { fields: query.fields } : undefined,
    );
  }

  public async getById(
    id: number,
    includeArchived = true,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, includeArchived);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }
    const [hydrated] = await this.hydrateUsersList([user]);
    if (actor) {
      await this.assertCanAccessUserRecord(hydrated!, actor, 'read');
    }
    return hydrated!;
  }

  public async getStatusHistory(
    userId: number,
    actor?: UserIdentity,
  ): Promise<UserStatusHistoryItemResponse[]> {
    const userResp = await this.getById(userId, true, actor);
    if (!this.statusHistoryRepository) {
      return [];
    }
    const rows = await this.statusHistoryRepository.findByUserId(userResp.id);
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

  public async create(dto: CreateUserRequest, actorId?: number): Promise<UserResponse> {
    const { normalizedEmail, finalUsername, normalizedPhone, phoneHash, roleIds, orgInputs } =
      await validateAndPrepareCreateUserContext({
        dto,
        userRepository: this.userRepository,
        passwordHasher: this.passwordHasher,
        rolesPublicService: this.rolesPublicService,
        organizationsPublicService: this.organizationsPublicService,
      });

    const nameParts = resolveVietnameseNameParts({
      firstName: dto.firstName,
      lastName: dto.lastName,
      fullName: dto.fullName,
    });
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const primaryOrgInput = orgInputs.find((o) => o.isPrimary) ?? orgInputs[0];
    const initialStatus = dto.status ?? USER_STATUS.ACTIVE;
    const encryptedPhone = this.encryptPhone(normalizedPhone ?? dto.phone);

    const work = async (): Promise<UserEntity> => {
      const savedUser = await this.userRepository.saveEntity({
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
        passwordChangedAt: new Date(),
      });

      const userId = Number(savedUser.id);
      const preferredLocale = normalizePreferredLocaleOrThrow(dto.preferredLocale);
      const preferredTimezone = normalizePreferredTimezoneOrThrow(dto.preferredTimezone);
      await this.upsertUserProfile(userId, {
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
        await this.userRoleRepository.replaceUserRoles(userId, roleIds, actorId);
      }

      if (orgInputs.length > 0) {
        await this.userOrgRepository.replaceUserOrganizations(userId, orgInputs);
      }

      await this.recordStatusHistory(
        userId,
        null,
        initialStatus,
        'Initial account creation',
        actorId,
      );

      return savedUser;
    };

    const created = this.transactionManager
      ? await this.transactionManager.runInTransaction(work)
      : await work();

    const result = await this.getById(Number(created.id));
    await this.auditLogService?.record({
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
    return result;
  }

  public async update(
    id: number,
    dto: UpdateUserRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }
    if (actor) {
      await this.ensureAccessUserEntity(user, actor, 'update');
    }
    const beforeSnapshot = {
      id: user.id,
      username: user.username,
      email: user.email,
      managerId: user.managerId ?? null,
      status: user.status,
    };

    const currentProfile = await this.getUserProfile(id, user);
    const { nextFirstName, nextLastName, nextFullName } = await validateAndApplyUserUpdateFields({
      id,
      user,
      dto,
      currentProfile,
      userRepository: this.userRepository,
      passwordHasher: this.passwordHasher,
      encryptPhone: (p) => this.encryptPhone(p),
      resolveSubordinateUserIds: (mid) => this.resolveSubordinateUserIds(mid),
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
        await this.userRepository.updateWithOptimisticLock(id, dto.expectedVersion, {
          email: user.email,
          phone: user.phone ?? null,
          phoneHash: user.phoneHash ?? null,
          managerId: user.managerId ?? null,
        });
      } else {
        await this.userRepository.saveEntity(user);
      }

      await this.upsertUserProfile(id, {
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

    if (this.transactionManager) {
      await this.transactionManager.runInTransaction(persistChanges);
    } else {
      await persistChanges();
    }

    await this.invalidateIdentityCache(id);
    const updated = await this.getById(id, true);
    await this.auditLogService?.record({
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
        status: updated.status,
        fullName: updated.fullName,
      },
    });
    return updated;
  }

  public async lockUser(
    id: number,
    dto: LockUserRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    let lockedUntilDate: Date | null = null;
    if (dto.lockedUntil) {
      lockedUntilDate = new Date(dto.lockedUntil);
      if (Number.isNaN(lockedUntilDate.getTime()) || lockedUntilDate.getTime() <= Date.now()) {
        throw new BadRequestAppException('users.invalidLockedUntilDate');
      }
    }

    const reason = dto.reason.trim();
    return this.runStatusTransition({
      id,
      toStatus: USER_STATUS.LOCKED,
      action: 'user.lock',
      reason,
      actorId,
      actor,
      lockedUntil: lockedUntilDate,
      lockReason: reason,
      archiveTimestamp: null,
    });
  }

  public async unlockUser(
    id: number,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.runStatusTransition({
      id,
      toStatus: USER_STATUS.ACTIVE,
      action: 'user.unlock',
      reason: 'Account unlocked',
      actorId,
      actor,
      lockedUntil: null,
      lockReason: null,
      resetFailedAttempts: true,
      archiveTimestamp: null,
    });
  }

  public async deactivateUser(
    id: number,
    reason?: string | null,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.runStatusTransition({
      id,
      toStatus: USER_STATUS.INACTIVE,
      action: 'user.deactivate',
      reason: reason ?? 'Account deactivated',
      actorId,
      actor,
      ...(reason !== undefined
        ? { lockReason: reason ? reason.trim() : null }
        : { preserveLockReason: true }),
      archiveTimestamp: null,
    });
  }

  public async activateUser(
    id: number,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.runStatusTransition({
      id,
      toStatus: USER_STATUS.ACTIVE,
      action: 'user.activate',
      reason: 'Account activated',
      actorId,
      actor,
      lockedUntil: null,
      lockReason: null,
      resetFailedAttempts: true,
      archiveTimestamp: null,
    });
  }

  public async changeStatus(
    id: number,
    dto: ChangeUserStatusRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    if (dto.status === USER_STATUS.LOCKED) {
      return this.lockUser(
        id,
        {
          reason: dto.reason || 'Locked by administrator',
          lockedUntil: dto.lockedUntil ?? null,
        },
        actorId,
        actor,
      );
    }
    if (dto.status === USER_STATUS.INACTIVE) {
      return this.deactivateUser(id, dto.reason ?? null, actorId, actor);
    }
    if (dto.status === USER_STATUS.ARCHIVED) {
      return this.archiveUser(id, actorId, actor);
    }
    return this.activateUser(id, actorId, actor);
  }

  public async archiveUser(
    id: number,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.runStatusTransition({
      id,
      toStatus: USER_STATUS.ARCHIVED,
      action: 'user.archive',
      reason: 'Account archived',
      actorId,
      actor,
      preserveLockReason: true,
      archiveTimestamp: new Date(),
    });
  }

  public async restoreUser(
    id: number,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.runStatusTransition({
      id,
      toStatus: USER_STATUS.INACTIVE,
      action: 'user.restore',
      reason: 'Account restored from archive',
      actorId,
      actor,
      preserveLockReason: true,
      archiveTimestamp: null,
    });
  }

  public async assignRoles(
    id: number,
    dto: AssignUserRolesRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    return executeAssignUserRolesFlow({
      id,
      dto,
      actorId,
      actor,
      userRepository: this.userRepository,
      userRoleRepository: this.userRoleRepository,
      rolesPublicService: this.rolesPublicService,
      verifySensitiveActionStepUp: (aid, tok, req, act) =>
        this.verifySensitiveActionStepUp(aid, tok, req, act),
      ensureAccessUserEntity: (u, act, action) => this.ensureAccessUserEntity(u, act, action),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
      getById: (uid) => this.getById(uid),
      auditLogService: this.auditLogService,
      platformSecurityService: this.platformSecurityService,
    });
  }

  public async assignOrganizations(
    id: number,
    dto: AssignUserOrganizationsRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    return executeAssignUserOrganizationsFlow({
      id,
      dto,
      actorId,
      actor,
      userRepository: this.userRepository,
      userOrgRepository: this.userOrgRepository,
      organizationsPublicService: this.organizationsPublicService,
      transactionManager: this.transactionManager,
      ensureAccessUserEntity: (u, act, action) => this.ensureAccessUserEntity(u, act, action),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
      getById: (uid) => this.getById(uid),
      auditLogService: this.auditLogService,
    });
  }

  public async findAuthUserByIdentifier(
    identifier: string,
  ): Promise<UserAuthCredentialsView | null> {
    const trimmed = identifier.trim();
    const normalizedPhone = normalizePhoneNumber(trimmed);
    const phoneHash =
      normalizedPhone && /^[0-9+]+$/.test(trimmed.replace(/[\s.\-()]/g, ''))
        ? this.passwordHasher.sha256(normalizedPhone)
        : null;

    let user = await this.userRepository.findByIdentifier(trimmed, phoneHash);
    if (!user && phoneHash && typeof this.userRepository.findByPhoneHash === 'function') {
      user = await this.userRepository.findByPhoneHash(phoneHash, true);
    }

    if (!user) return null;
    return this.toAuthCredentialsView(user);
  }

  public async findAuthCredentialsByUserId(
    userId: number,
  ): Promise<UserAuthCredentialsView | null> {
    const user = await this.userRepository.findByIdWithArchived(userId, true);
    if (!user) return null;
    return this.toAuthCredentialsView(user);
  }

  private async toAuthCredentialsView(user: UserEntity): Promise<UserAuthCredentialsView> {
    return buildUserAuthCredentialsView({
      user,
      getUserProfile: (uid, u) => this.getUserProfile(uid, u),
      decryptPhone: (p) => this.decryptPhone(p),
    });
  }

  public async findAuthUserById(userId: number): Promise<UserAuthIdentityView | null> {
    return buildUserAuthIdentityView({
      userId,
      userRepository: this.userRepository,
      userRoleRepository: this.userRoleRepository,
      userOrgRepository: this.userOrgRepository,
      rolesPublicService: this.rolesPublicService,
      getUserProfile: (uid, u) => this.getUserProfile(uid, u),
      decryptPhone: (p) => this.decryptPhone(p),
    });
  }

  public async getUserPreferences(userId: number): Promise<UserPreferencesView> {
    return resolveUserPreferencesView({
      userId,
      userRepository: this.userRepository,
      userProfileRepository: this.userProfileRepository,
    });
  }

  public async updateUserPreferences(
    userId: number,
    input: UpdateUserPreferencesInput,
  ): Promise<UserPreferencesView> {
    return updateUserPreferencesRecord({
      userId,
      input,
      userRepository: this.userRepository,
      getUserProfile: (uid, u) => this.getUserProfile(uid, u),
      normalizePreferredLocale: (l) => normalizePreferredLocaleOrThrow(l),
      normalizePreferredTimezone: (tz) => normalizePreferredTimezoneOrThrow(tz),
      upsertUserProfile: (uid, d) => this.upsertUserProfile(uid, d),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
      auditLogService: this.auditLogService,
    });
  }

  public async registerSelfUser(input: SelfRegisterUserInput): Promise<UserAuthIdentityView> {
    return executeSelfRegisterUser({
      input,
      userRepository: this.userRepository,
      passwordHasher: this.passwordHasher,
      encryptPhone: (p) => this.encryptPhone(p),
      normalizePreferredLocale: (l) => normalizePreferredLocaleOrThrow(l),
      normalizePreferredTimezone: (tz) => normalizePreferredTimezoneOrThrow(tz),
      upsertUserProfile: (uid, d) => this.upsertUserProfile(uid, d),
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      findAuthUserById: (uid) => this.findAuthUserById(uid),
    });
  }

  public async markEmailVerified(userId: number): Promise<void> {
    await markUserChannelVerified({
      userId,
      channel: 'EMAIL',
      userRepository: this.userRepository,
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async markPhoneVerified(userId: number): Promise<void> {
    await markUserChannelVerified({
      userId,
      channel: 'PHONE',
      userRepository: this.userRepository,
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async recordLoginSuccess(userId: number): Promise<void> {
    await recordUserLoginAttemptState({
      userId,
      outcome: 'SUCCESS',
      userRepository: this.userRepository,
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async recordLoginFailure(
    userId: number,
    maxAttempts = 5,
    lockDurationMinutes = 15,
  ): Promise<{ failedAttempts: number; locked: boolean; lockedUntil: Date | null }> {
    return recordUserLoginAttemptState({
      userId,
      outcome: 'FAILURE',
      maxAttempts,
      lockDurationMinutes,
      userRepository: this.userRepository,
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async autoUnlockExpiredLock(userId: number): Promise<void> {
    await recordUserLoginAttemptState({
      userId,
      outcome: 'AUTO_UNLOCK',
      userRepository: this.userRepository,
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async updatePasswordHash(
    userId: number,
    newPasswordHash: string,
    options?: { recordHistory?: boolean; maxHistory?: number },
  ): Promise<void> {
    await executeUpdateUserPasswordHash({
      userId,
      newPasswordHash,
      options,
      userRepository: this.userRepository,
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public registerAdminPasswordResetDelegate(
    delegate: (
      userId: number,
      input: AdminResetUserPasswordInput,
      actorId?: number,
    ) => Promise<AdminResetUserPasswordResult>,
  ): void {
    this.adminPasswordResetDelegate = delegate;
  }

  public registerAdminRevokeSessionsDelegate(
    delegate: (userId: number, reason?: string) => Promise<number>,
  ): void {
    this.adminRevokeSessionsDelegate = delegate;
  }

  public registerUserLoginHistoryDelegate(
    delegate: (userId: number, limit?: number) => Promise<UserLoginHistoryItemView[]>,
  ): void {
    this.userLoginHistoryDelegate = delegate;
  }

  public registerAdminResetMfaDelegate(
    delegate: (
      userId: number,
      input: AdminResetUserMfaInput,
      actorId?: number,
    ) => Promise<AdminResetUserMfaResult>,
  ): void {
    this.adminResetMfaDelegate = delegate;
  }

  public registerStepUpVerificationDelegate(
    delegate: (userId: number, stepUpToken: string, action?: string) => Promise<boolean>,
  ): void {
    this.stepUpVerificationDelegate = delegate;
  }

  public async verifySensitiveActionStepUp(
    actorId?: number,
    stepUpToken?: string,
    requireStepUp?: boolean,
    action?: string,
  ): Promise<void> {
    if (!requireStepUp && !stepUpToken) return;
    if (!stepUpToken || !stepUpToken.trim()) {
      throw new ForbiddenAppException('auth.stepUpAuthenticationRequired', [{ action }]);
    }
    if (!this.stepUpVerificationDelegate) return;
    const isValid = await this.stepUpVerificationDelegate(actorId ?? 0, stepUpToken.trim(), action);
    if (!isValid) {
      throw new ForbiddenAppException('auth.invalidOrExpiredStepUpToken', [{ action }]);
    }
  }

  public async adminResetMfa(
    id: number,
    dto: AdminResetUserMfaInput,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<AdminResetUserMfaResult> {
    return executeAdminResetUserMfaFlow({
      id,
      dto,
      actorId,
      actor,
      userRepository: this.userRepository,
      verifySensitiveActionStepUp: (aid, tok, req, act) =>
        this.verifySensitiveActionStepUp(aid, tok, req, act),
      ensureAccessUserRecord: (u, act, action) => this.ensureAccessUserEntity(u, act, action),
      adminResetMfaDelegate: this.adminResetMfaDelegate,
      adminRevokeSessionsDelegate: this.adminRevokeSessionsDelegate,
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async revokeUserSessions(
    id: number,
    reason?: string,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<{
    revoked: true;
    userId: number;
    revokedCount: number;
    revokedSessionsCount: number;
    reason: string;
  }> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) throw new NotFoundAppException('users.notFound', { id });
    if (actor) await this.ensureAccessUserEntity(user, actor, 'status');

    const effectiveReason =
      reason?.trim() ||
      (actorId
        ? `Revoked all sessions by administrator #${actorId} due to security incident`
        : 'Revoked all sessions by administrator due to security incident');

    const revokedCount = this.adminRevokeSessionsDelegate
      ? await this.adminRevokeSessionsDelegate(id, effectiveReason)
      : 0;

    await this.invalidateIdentityCache(id);
    return {
      revoked: true,
      userId: Number(id),
      revokedCount,
      revokedSessionsCount: revokedCount,
      reason: effectiveReason,
    };
  }

  public async getLoginHistory(
    id: number,
    limit?: number,
    actor?: UserIdentity,
  ): Promise<UserLoginHistoryItemView[]> {
    const userResp = await this.getById(id, true, actor);
    if (!this.userLoginHistoryDelegate) return [];
    const effectiveLimit =
      limit ??
      defaultSettingRegistry.getNumber(
        USERS_SETTING_KEYS.LOGIN_HISTORY_DEFAULT_LIMIT,
        undefined,
        50,
      );
    return this.userLoginHistoryDelegate(userResp.id, effectiveLimit);
  }

  public async getUserLoginHistory(
    id: number,
    limit?: number,
    actor?: UserIdentity,
  ): Promise<UserLoginHistoryItemView[]> {
    return this.getLoginHistory(id, limit, actor);
  }

  public async adminResetPassword(
    id: number,
    dto: AdminResetUserPasswordInput,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<AdminResetUserPasswordResult> {
    return executeAdminResetUserPasswordFlow({
      id,
      dto,
      actorId,
      actor,
      userRepository: this.userRepository,
      passwordHasher: this.passwordHasher,
      ensureAccessUserRecord: (u, act, action) => this.ensureAccessUserEntity(u, act, action),
      adminPasswordResetDelegate: this.adminPasswordResetDelegate,
      updatePasswordHash: (uid, hash) => this.updatePasswordHash(uid, hash),
      unlockUser: (uid, aid) => this.unlockUser(uid, aid),
    });
  }

  private async ensureAccessUserEntity(
    user: UserEntity,
    actor: UserIdentity,
    action: string,
  ): Promise<void> {
    const [hydratedTarget] = await this.hydrateUsersList([user]);
    await this.assertCanAccessUserRecord(hydratedTarget!, actor, action);
  }

  private async runStatusTransition(params: {
    id: number;
    toStatus: UserStatusCode;
    action: UserStatusTransitionAction;
    reason: string;
    actorId?: number | undefined;
    actor?: UserIdentity | undefined;
    lockedUntil?: Date | null | undefined;
    lockReason?: string | null | undefined;
    preserveLockReason?: boolean | undefined;
    archiveTimestamp?: Date | null | undefined;
    resetFailedAttempts?: boolean | undefined;
  }): Promise<UserResponse> {
    return executeUserStatusTransition({
      ...params,
      userRepository: this.userRepository,
      ensureAccessUserRecord: (u, act, action) => this.ensureAccessUserEntity(u, act, action),
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
      getById: (uid, inc) => this.getById(uid, inc),
      auditLogService: this.auditLogService,
    });
  }

  public async setMfaEnabled(userId: number, enabled: boolean): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) throw new NotFoundAppException('users.notFound', { id: userId });
    user.mfaEnabled = enabled;
    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);
  }

  public async hydrateUsersList(users: readonly UserEntity[]): Promise<UserResponse[]> {
    return hydrateUsersResponseList({
      users,
      userRoleRepository: this.userRoleRepository,
      userOrgRepository: this.userOrgRepository,
      findProfilesByUserIds: (uids) => this.findProfilesByUserIds(uids),
      rolesPublicService: this.rolesPublicService,
      organizationsPublicService: this.organizationsPublicService,
      mapper: this.mapper,
      decryptPhone: (p) => this.decryptPhone(p),
    });
  }

  private async upsertUserProfile(
    userId: number,
    data: Partial<UserProfileEntity>,
  ): Promise<UserProfileEntity> {
    if (!this.userProfileRepository) throw new Error('UserProfileRepository is not initialized');
    return await this.userProfileRepository.upsertByUserId(userId, data);
  }

  private async findProfilesByUserIds(userIds: readonly number[]): Promise<UserProfileEntity[]> {
    if (!this.userProfileRepository) throw new Error('UserProfileRepository is not initialized');
    return await this.userProfileRepository.findByUserIds(userIds);
  }

  private async getUserProfile(userId: number, user?: UserEntity): Promise<UserProfileView> {
    return resolveUserProfileView({
      userId,
      user,
      userProfileRepository: this.userProfileRepository,
    });
  }

  private encryptPhone(phone?: string | null): string | null {
    if (!phone || !phone.trim()) return null;
    const trimmed = phone.trim();
    return this.fieldEncryption ? this.fieldEncryption.encrypt(trimmed) : trimmed;
  }

  private decryptPhone(phone?: string | null): string | null {
    if (!phone) return null;
    return this.fieldEncryption ? this.fieldEncryption.decrypt(phone) : phone;
  }

  private async recordStatusHistory(
    userId: number,
    fromStatus: UserStatusCode | null,
    toStatus: UserStatusCode,
    reason?: string | null,
    changedBy?: number | null,
  ): Promise<void> {
    if (!this.statusHistoryRepository)
      throw new Error('UserStatusHistoryRepository is not initialized');
    await this.statusHistoryRepository.recordTransition({
      userId,
      fromStatus,
      toStatus,
      reason: reason ?? null,
      changedBy: changedBy ?? null,
    });
  }

  private async countUsersByRoleIds(roleIds: readonly number[]): Promise<Map<number, number>> {
    return countActiveUsersByRoleIds({
      roleIds,
      userRoleRepository: this.userRoleRepository,
      userRepository: this.userRepository,
    });
  }

  private async listUsersByRoleId(roleId: number): Promise<RoleAssignedUserSummary[]> {
    return listActiveUsersByRoleId({
      roleId,
      userRoleRepository: this.userRoleRepository,
      userRepository: this.userRepository,
      findProfilesByUserIds: (uids) => this.findProfilesByUserIds(uids),
    });
  }

  public async findActiveUserIdsByIds(userIds: readonly number[]): Promise<number[]> {
    return filterActiveUserIds(this.userRepository, userIds);
  }

  public async findActiveUserIdsByRoleIds(roleIds: readonly number[]): Promise<number[]> {
    return resolveActiveUserIdsByRoleIds({
      roleIds,
      userRoleRepository: this.userRoleRepository,
      userRepository: this.userRepository,
    });
  }

  public async findActiveUserIdsByOrganizationUnitIds(
    unitIds: readonly number[],
  ): Promise<number[]> {
    return resolveActiveUserIdsByOrganizationUnitIds({
      unitIds,
      userOrgRepository: this.userOrgRepository,
      userRepository: this.userRepository,
    });
  }

  public async findUserContactsByIds(
    userIds: readonly number[],
  ): Promise<UserNotificationContactView[]> {
    return resolveUserNotificationContacts({
      userIds,
      userRepository: this.userRepository,
      findProfilesByUserIds: (uids) => this.findProfilesByUserIds(uids),
      decryptPhone: (p) => this.decryptPhone(p),
    });
  }

  private async invalidateIdentityCache(userId: number): Promise<void> {
    if (!this.redis?.isReady()) return;
    await this.redis.client.del(`${USER_IDENTITY_CACHE_PREFIX}${userId}`).catch(() => undefined);
  }
}
