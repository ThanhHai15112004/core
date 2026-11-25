import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  DomainEventBusService,
  NotFoundAppException,
  type PaginatedResult,
  defaultCustomFieldRegistry,
  defaultDomainEventBus,
  defaultSearchRegistry,
  parseCustomFieldFiltersParam,
  resolvePagination,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { TransactionManager } from '@packages/database/index.js';
import {
  AuditLogService,
  DataScopeService,
  FieldEncryptionService,
  PasswordHasherService,
  PlatformSecurityService,
  type ResolvedDataScopeFilter,
  TokenService,
  type UserIdentity,
  createDefaultDataScopeService,
} from '@packages/security/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import { type IRolesPublicService, ROLES_PUBLIC_SERVICE } from '@modules/roles/contracts/index.js';
import {
  type IUsersPublicService,
  type SelfRegisterUserInput,
  USER_IDENTITY_CACHE_PREFIX,
  USER_STATUS,
  USERS_SETTING_KEYS,
  type UpdateUserPreferencesInput,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
  type UserApproverSummaryView,
  type UserNotificationContactView,
  type UserPreferencesView,
  type UserStatusCode,
  type UserSubordinateSummaryView,
} from '../contracts/index.js';
import type { UserStatusTransitionAction } from '../types/users.types.js';
import {
  executeCreateUserRecordFlow,
  executeGetStatusHistoryFlow,
  executeUpdateUserRecordFlow,
  registerUsersCrossModuleDelegates,
  syncUserSearchDocumentSafe,
} from '../helpers/user-crud-orchestrator.helper.js';
import { hydrateUsersResponseList } from '../helpers/user-profile-hydration.helper.js';
import {
  executeAssignUserOrganizationsFlow,
  executeAssignUserRolesFlow,
  executeUserStatusTransition,
} from '../helpers/user-lifecycle-assignment.helper.js';
import {
  resolveUserApproverChain,
  resolveUserOrganizationHistoryList,
  resolveUserSubordinatesList,
} from '../helpers/user-subordinates-approval.helper.js';
import {
  type IOrganizationMembersHistoryPersistenceContract,
  type IOrganizationMembersPublicService,
  type IOrganizationMembersUnitPersistenceContract,
  ORGANIZATION_MEMBERS_PUBLIC_SERVICE,
} from '@modules/organization-members/index.js';
import type { UserEntity } from '../entities/user.entity.js';
import { UserRepository, type SearchUsersFilter } from '../repositories/user.repository.js';
import { UserProfileRepository } from '../repositories/user-profile.repository.js';
import { UserStatusHistoryRepository } from '../repositories/user-status-history.repository.js';
import { UsersMapper } from '../mappers/users.mapper.js';
import type {
  AssignUserOrganizationsRequest,
  AssignUserRolesRequest,
  ChangeUserStatusRequest,
  CreateUserRequest,
  ListUserSubordinatesQuery,
  ListUsersQuery,
  LockUserRequest,
  UpdateUserRequest,
} from '../requests/users.requests.js';
import type {
  UserOrganizationHistoryItemResponse,
  UserResponse,
  UserStatusHistoryItemResponse,
  UserSubordinatesOverviewResponse,
} from '../responses/users.response.js';
import { UserIdentityBridgeService } from './user-identity-bridge.service.js';
import {
  buildUserCreatedEventInput,
  buildUserUpdatedEventInput,
} from '../events/user-domain.events.js';

export { USER_IDENTITY_CACHE_PREFIX };

@Injectable()
export class UsersService implements IUsersPublicService {
  private readonly logger = new Logger(UsersService.name);
  private readonly effectiveDataScopeService: DataScopeService;
  private readonly identityBridge: UserIdentityBridgeService;

  constructor(
    private readonly userRepository: UserRepository,
    @Inject(ORGANIZATION_MEMBERS_PUBLIC_SERVICE)
    private readonly userOrgRepository: IOrganizationMembersUnitPersistenceContract &
      Partial<IOrganizationMembersPublicService>,
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
    @Optional()
    @Inject(ORGANIZATION_MEMBERS_PUBLIC_SERVICE)
    private readonly orgHistoryRepository: IOrganizationMembersHistoryPersistenceContract | null = null,
    @Optional()
    @Inject(TokenService)
    private readonly tokenService: TokenService | null = null,
    @Optional()
    identityBridge?: UserIdentityBridgeService | null,
    @Optional()
    private readonly domainEventBus: DomainEventBusService = defaultDomainEventBus,
  ) {
    this.effectiveDataScopeService = this.dataScopeService ?? createDefaultDataScopeService();
    this.identityBridge =
      identityBridge ??
      new UserIdentityBridgeService(
        this.userRepository,
        this.userOrgRepository,
        this.passwordHasher,
        this.rolesPublicService,
        this.statusHistoryRepository,
        this.fieldEncryption,
        this.redis,
        this.userProfileRepository,
        this.auditLogService,
        this.tokenService,
      );
    if (typeof this.userOrgRepository?.registerMemberUsersDelegate === 'function') {
      this.userOrgRepository.registerMemberUsersDelegate({
        listPaginated: (query, actor) =>
          this.listPaginated(
            {
              q: query.q,
              organizationUnitId: query.organizationUnitId,
              managerId: query.managerId,
              status: query.status,
              page: query.page,
              limit: query.limit,
              sortBy: query.sortBy ?? 'id',
              sortOrder: query.sortOrder ?? 'ASC',
            },
            actor,
          ),
        getById: (uid, includeRelations = true, actor) =>
          this.getById(uid, includeRelations, actor),
        assignOrganizations: (uid, dto, aid, act) =>
          this.assignOrganizations(
            uid,
            {
              organizationUnits: dto.organizationUnits.map((u) => ({
                organizationUnitId: u.organizationUnitId,
                isPrimary: Boolean(u.isPrimary),
                positionTitle: u.positionTitle ?? null,
                startDate: u.startDate ?? null,
                endDate: u.endDate ?? null,
              })),
              reason: dto.reason ?? null,
            },
            aid,
            act,
          ),
        update: (uid, dto, aid, act) =>
          this.update(
            uid,
            {
              ...(dto.managerId !== undefined ? { managerId: dto.managerId } : {}),
              ...(dto.temporaryManagerId !== undefined
                ? { temporaryManagerId: dto.temporaryManagerId }
                : {}),
              ...(dto.temporaryManagerFrom !== undefined
                ? { temporaryManagerFrom: dto.temporaryManagerFrom }
                : {}),
              ...(dto.temporaryManagerUntil !== undefined
                ? { temporaryManagerUntil: dto.temporaryManagerUntil }
                : {}),
            },
            aid,
            act,
          ),
        getOrganizationHistory: (uid, act) => this.getOrganizationHistory(uid, act),
        getSubordinatesOverview: (uid, q, act) => this.getSubordinatesOverview(uid, q ?? {}, act),
        listSubordinates: (mid, opts, act) => this.listSubordinates(mid, opts, act),
        resolveSubordinateUserIds: (mid, opts) => this.resolveSubordinateUserIds(mid, opts),
        resolveApproverChain: (uid, maxLevels) => this.resolveApproverChain(uid, maxLevels),
      });
    }
    registerUsersCrossModuleDelegates({
      rolesPublicService: this.rolesPublicService,
      organizationsPublicService: this.organizationsPublicService,
      effectiveDataScopeService: this.effectiveDataScopeService,
      userRepository: this.userRepository,
      userProfileRepository: this.userProfileRepository,
      userOrgRepository: this.userOrgRepository,
      countUsersByRoleIds: (rids) => this.identityBridge.countUsersByRoleIds(rids),
      listUsersByRoleId: (rid) => this.identityBridge.listUsersByRoleId(rid),
      assignRoles: (uid, dto, aid, act) =>
        this.assignRoles(
          uid,
          {
            roleIds: [...dto.roleIds],
            ...(dto.stepUpToken !== undefined ? { stepUpToken: dto.stepUpToken } : {}),
            ...(dto.requireStepUp !== undefined ? { requireStepUp: dto.requireStepUp } : {}),
          },
          aid,
          act,
        ),
      resolveSubordinateUserIds: (mid) => this.resolveSubordinateUserIds(mid),
      findAuthUserByIdentifier: (ident) => this.findAuthUserByIdentifier(ident),
      findUserContactsByIds: (uids) => this.findUserContactsByIds(uids),
    });
  }

  public getDataScopeService(): DataScopeService {
    return this.effectiveDataScopeService;
  }

  public async resolveSubordinateUserIds(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<number[]> {
    if (typeof this.userRepository.findSubordinateUserIds === 'function') {
      return this.userRepository.findSubordinateUserIds(managerId, options);
    }
    return [];
  }

  public async listSubordinates(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
    actor?: UserIdentity,
  ): Promise<UserSubordinateSummaryView[]> {
    await this.getById(managerId, true, actor);
    return resolveUserSubordinatesList({
      managerId,
      options,
      userRepository: this.userRepository,
      userOrgRepository: this.userOrgRepository,
      findProfilesByUserIds: (uids) => this.identityBridge.findProfilesByUserIds(uids),
      organizationsPublicService: this.organizationsPublicService,
    });
  }

  public async resolveApproverChain(
    userId: number,
    maxLevels = 5,
    actor?: UserIdentity,
  ): Promise<UserApproverSummaryView[]> {
    await this.getById(userId, true, actor);
    return resolveUserApproverChain({
      userId,
      maxLevels,
      userRepository: this.userRepository,
      userOrgRepository: this.userOrgRepository,
      findProfilesByUserIds: (uids) => this.identityBridge.findProfilesByUserIds(uids),
    });
  }

  public async getSubordinatesOverview(
    userId: number,
    query?: ListUserSubordinatesQuery,
    actor?: UserIdentity,
  ): Promise<UserSubordinatesOverviewResponse> {
    const userResp = await this.getById(userId, true, actor);
    const options = {
      ...(query?.directOnly !== undefined ? { directOnly: query.directOnly } : {}),
      ...(query?.includeTemporary !== undefined
        ? { includeTemporary: query.includeTemporary }
        : {}),
    };
    const [subordinates, approverChain] = await Promise.all([
      resolveUserSubordinatesList({
        managerId: userResp.id,
        options,
        userRepository: this.userRepository,
        userOrgRepository: this.userOrgRepository,
        findProfilesByUserIds: (uids) => this.identityBridge.findProfilesByUserIds(uids),
        organizationsPublicService: this.organizationsPublicService,
      }),
      resolveUserApproverChain({
        userId: userResp.id,
        maxLevels: 5,
        userRepository: this.userRepository,
        userOrgRepository: this.userOrgRepository,
        findProfilesByUserIds: (uids) => this.identityBridge.findProfilesByUserIds(uids),
      }),
    ]);

    return {
      userId: userResp.id,
      managerId: userResp.id,
      directCount: subordinates.filter((s) => s.relationType === 'DIRECT').length,
      temporaryCount: subordinates.filter((s) => s.relationType === 'TEMPORARY').length,
      indirectCount: subordinates.filter((s) => s.relationType === 'INDIRECT').length,
      totalSubordinates: subordinates.length,
      subordinates,
      approverChain,
    };
  }

  public async getOrganizationHistory(
    userId: number,
    actor?: UserIdentity,
  ): Promise<UserOrganizationHistoryItemResponse[]> {
    const userResp = await this.getById(userId, true, actor);
    return resolveUserOrganizationHistoryList({
      userId: userResp.id,
      userOrgHistoryRepository: this.orgHistoryRepository,
      organizationsPublicService: this.organizationsPublicService,
    });
  }

  public async resolveUserScopeFilter(
    actor?: UserIdentity,
    action = 'read',
  ): Promise<ResolvedDataScopeFilter | undefined> {
    if (!actor) return undefined;
    const scopeFilter = await this.effectiveDataScopeService.resolveScopeFilter(
      actor,
      'users',
      action,
    );
    if (
      scopeFilter &&
      !scopeFilter.isUnrestricted &&
      scopeFilter.allowedOrganizationUnitIds.length > 0 &&
      typeof this.userOrgRepository?.findUserIdsByOrganizationUnitIds === 'function'
    ) {
      const orgMemberIds = await this.userOrgRepository.findUserIdsByOrganizationUnitIds(
        scopeFilter.allowedOrganizationUnitIds,
      );
      if (orgMemberIds.length > 0) {
        return {
          ...scopeFilter,
          allowedUserIds: [...new Set([...scopeFilter.allowedUserIds, ...orgMemberIds])],
        };
      }
    }
    return scopeFilter;
  }

  public async enrichSearchUsersFilter(filter: SearchUsersFilter): Promise<SearchUsersFilter> {
    let roleMemberUserIds = filter.roleMemberUserIds;
    if (filter.roleId !== undefined && roleMemberUserIds === undefined) {
      if (typeof this.rolesPublicService?.findUserIdsByRoleIds === 'function') {
        roleMemberUserIds = await this.rolesPublicService.findUserIdsByRoleIds([filter.roleId]);
      } else if (typeof this.rolesPublicService?.findUserRoleLinksByRoleIds === 'function') {
        const links = await this.rolesPublicService.findUserRoleLinksByRoleIds([filter.roleId]);
        roleMemberUserIds = [...new Set(links.map((l) => Number(l.userId)))];
      }
    }

    let organizationMemberUserIds = filter.organizationMemberUserIds;
    if (
      filter.organizationUnitId !== undefined &&
      organizationMemberUserIds === undefined &&
      typeof this.userOrgRepository?.findUserIdsByOrganizationUnitIds === 'function'
    ) {
      organizationMemberUserIds = await this.userOrgRepository.findUserIdsByOrganizationUnitIds([
        filter.organizationUnitId,
      ]);
    }

    return {
      ...filter,
      ...(roleMemberUserIds !== undefined ? { roleMemberUserIds } : {}),
      ...(organizationMemberUserIds !== undefined ? { organizationMemberUserIds } : {}),
    };
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
        managerId: targetUser.effectiveManagerId ?? targetUser.managerId ?? null,
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
    let allowedUserIds: number[] | undefined;
    if (query.customFieldFilters) {
      const cfFilters = parseCustomFieldFiltersParam(query.customFieldFilters);
      if (cfFilters.length > 0) {
        const matchedIds = defaultCustomFieldRegistry.filterRecordIdsByCustomFields({
          entityCode: 'users.user',
          filters: cfFilters,
          actor: actor
            ? {
                id: actor.id,
                roles: actor.roles,
                permissions: actor.permissions,
                bypassPermissionCheck: actor.roles?.includes('super_admin'),
              }
            : { bypassPermissionCheck: true },
        });
        allowedUserIds = matchedIds
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0);
      }
    }

    const searchFilter = await this.enrichSearchUsersFilter({
      ...query,
      page,
      limit,
      countMode,
      ...(allowedUserIds !== undefined ? { allowedUserIds } : {}),
      ...(scopeFilter ? { scopeFilter } : {}),
    });
    const { items, total } = await this.userRepository.searchPaginated(searchFilter);
    const enriched = await this.hydrateUsersList(items, { viewMode: 'list', actor });
    return createPaginatedResult(
      enriched,
      countMode === 'none' ? null : total,
      page,
      limit,
      query.fields ? { fields: query.fields } : undefined,
    );
  }

  /** Alias chuẩn cho `listPaginated` để tương thích với các bộ nạp dữ liệu đồng bộ/tìm kiếm */
  public async findAll(
    query: ListUsersQuery = { sortBy: 'id', sortOrder: 'ASC' },
    actor?: UserIdentity,
  ): Promise<PaginatedResult<UserResponse>> {
    return this.listPaginated(query, actor);
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
    const [hydrated] = await this.hydrateUsersList([user], { viewMode: 'detail', actor });
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
    return executeGetStatusHistoryFlow({
      userId: userResp.id,
      statusHistoryRepository: this.statusHistoryRepository,
    });
  }

  public async create(
    dto: CreateUserRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    const created = await executeCreateUserRecordFlow({
      dto,
      actorId,
      actor,
      userRepository: this.userRepository,
      userOrgRepository: this.userOrgRepository,
      orgHistoryRepository: this.orgHistoryRepository,
      passwordHasher: this.passwordHasher,
      rolesPublicService: this.rolesPublicService,
      organizationsPublicService: this.organizationsPublicService,
      transactionManager: this.transactionManager,
      auditLogService: this.auditLogService,
      encryptPhone: (p) => this.identityBridge.encryptPhone(p),
      upsertUserProfile: (uid, d) => this.identityBridge.upsertUserProfile(uid, d),
      recordStatusHistory: (uid, from, to, r, by) =>
        this.identityBridge.recordStatusHistory(uid, from, to, r, by),
      saveUserPasswordHash: (uid, hash, opts) =>
        this.identityBridge.saveUserPasswordHash(uid, hash, opts),
      getById: (uid) => this.getById(uid, true, actor),
      syncUserSearchDocumentSafe: (u, aid) => this.syncUserSearchDocumentSafe(u, aid),
    });
    await this.domainEventBus.publish(
      buildUserCreatedEventInput(created, actorId ?? actor?.id ?? null),
    );
    return created;
  }

  public async update(
    id: number,
    dto: UpdateUserRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    const updated = await executeUpdateUserRecordFlow({
      id,
      dto,
      actorId,
      actor,
      userRepository: this.userRepository,
      passwordHasher: this.passwordHasher,
      transactionManager: this.transactionManager,
      auditLogService: this.auditLogService,
      ensureAccessUserEntity: (u, act, action) => this.ensureAccessUserEntity(u, act, action),
      getUserProfile: (uid, u) => this.identityBridge.getUserProfile(uid, u),
      encryptPhone: (p) => this.identityBridge.encryptPhone(p),
      resolveSubordinateUserIds: (mid) => this.resolveSubordinateUserIds(mid),
      upsertUserProfile: (uid, d) => this.identityBridge.upsertUserProfile(uid, d),
      invalidateIdentityCache: (uid) => this.identityBridge.invalidateIdentityCache(uid),
      getById: (uid, inc) => this.getById(uid, inc),
      syncUserSearchDocumentSafe: (u, aid) => this.syncUserSearchDocumentSafe(u, aid),
    });
    const changedFields = Object.keys(dto).filter(
      (k) => (dto as Record<string, unknown>)[k] !== undefined,
    );
    await this.domainEventBus.publish(
      buildUserUpdatedEventInput(updated, changedFields, actorId ?? actor?.id ?? null),
    );
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
    const updated = await executeAssignUserRolesFlow({
      id,
      dto,
      actorId,
      actor,
      userRepository: this.userRepository,
      rolesPublicService: this.rolesPublicService,
      verifySensitiveActionStepUp: (aid, tok, req, act) =>
        this.verifySensitiveActionStepUp(aid, tok, req, act),
      ensureAccessUserEntity: (u, act, action) => this.ensureAccessUserEntity(u, act, action),
      invalidateIdentityCache: (uid) => this.identityBridge.invalidateIdentityCache(uid),
      getById: (uid) => this.getById(uid),
      auditLogService: this.auditLogService,
      platformSecurityService: this.platformSecurityService,
    });
    await this.syncUserSearchDocumentSafe(updated, actorId ?? actor?.id);
    return updated;
  }

  public async assignOrganizations(
    id: number,
    dto: AssignUserOrganizationsRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    const updated = await executeAssignUserOrganizationsFlow({
      id,
      dto,
      actorId,
      actor,
      userRepository: this.userRepository,
      userOrgRepository: this.userOrgRepository,
      userOrgHistoryRepository: this.orgHistoryRepository,
      organizationsPublicService: this.organizationsPublicService,
      transactionManager: this.transactionManager,
      ensureAccessUserEntity: (u, act, action) => this.ensureAccessUserEntity(u, act, action),
      invalidateIdentityCache: (uid) => this.identityBridge.invalidateIdentityCache(uid),
      getById: (uid) => this.getById(uid),
      auditLogService: this.auditLogService,
    });
    await this.syncUserSearchDocumentSafe(updated, actorId ?? actor?.id);
    return updated;
  }

  public async findAuthUserByIdentifier(
    identifier: string,
  ): Promise<UserAuthCredentialsView | null> {
    return this.identityBridge.findAuthUserByIdentifier(identifier);
  }

  public async findAuthCredentialsByUserId(
    userId: number,
  ): Promise<UserAuthCredentialsView | null> {
    return this.identityBridge.findAuthCredentialsByUserId(userId);
  }

  public async findAuthUserById(userId: number): Promise<UserAuthIdentityView | null> {
    return this.identityBridge.findAuthUserById(userId);
  }

  public async getUserPreferences(userId: number): Promise<UserPreferencesView> {
    return this.identityBridge.getUserPreferences(userId);
  }

  public async updateUserPreferences(
    userId: number,
    input: UpdateUserPreferencesInput,
  ): Promise<UserPreferencesView> {
    return this.identityBridge.updateUserPreferences(userId, input);
  }

  public async registerSelfUser(input: SelfRegisterUserInput): Promise<UserAuthIdentityView> {
    return this.identityBridge.registerSelfUser(input);
  }

  public async markEmailVerified(userId: number): Promise<void> {
    await this.identityBridge.markEmailVerified(userId);
  }

  public async markPhoneVerified(userId: number): Promise<void> {
    await this.identityBridge.markPhoneVerified(userId);
  }

  public async recordLoginSuccess(userId: number): Promise<void> {
    await this.identityBridge.recordLoginSuccess(userId);
  }

  public async recordLoginFailure(
    userId: number,
    maxAttempts = 5,
    lockDurationMinutes = 15,
  ): Promise<{ failedAttempts: number; locked: boolean; lockedUntil: Date | null }> {
    return this.identityBridge.recordLoginFailure(userId, maxAttempts, lockDurationMinutes);
  }

  public async autoUnlockExpiredLock(userId: number): Promise<void> {
    await this.identityBridge.autoUnlockExpiredLock(userId);
  }

  public async updatePasswordHash(
    userId: number,
    newPasswordHash: string,
    options?: { recordHistory?: boolean; maxHistory?: number },
  ): Promise<void> {
    await this.identityBridge.updatePasswordHash(userId, newPasswordHash, options);
  }

  public async verifySensitiveActionStepUp(
    actorId?: number,
    stepUpToken?: string,
    requireStepUp?: boolean,
    action?: string,
  ): Promise<void> {
    await this.identityBridge.verifySensitiveActionStepUp(
      actorId,
      stepUpToken,
      requireStepUp,
      action,
    );
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
    const result = await executeUserStatusTransition({
      ...params,
      userRepository: this.userRepository,
      ensureAccessUserRecord: (u, act, action) => this.ensureAccessUserEntity(u, act, action),
      recordStatusHistory: (uid, from, to, r, by) =>
        this.identityBridge.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.identityBridge.invalidateIdentityCache(uid),
      getById: (uid, inc) => this.getById(uid, inc),
      auditLogService: this.auditLogService,
    });
    if (params.toStatus === USER_STATUS.ARCHIVED) {
      await defaultSearchRegistry.removeDocuments('users.account', [result.id]).catch((err) => {
        this.logger.warn(
          `Failed to remove archived user #${result.id} from search index: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    } else {
      await this.syncUserSearchDocumentSafe(result, params.actorId ?? params.actor?.id);
    }
    return result;
  }

  private async syncUserSearchDocumentSafe(user: UserResponse, actorId?: number): Promise<void> {
    await syncUserSearchDocumentSafe(user, actorId);
  }

  public async setMfaEnabled(userId: number, enabled: boolean): Promise<void> {
    await this.identityBridge.setMfaEnabled(userId, enabled);
  }

  public async hydrateUsersList(
    users: readonly UserEntity[],
    options?: { viewMode?: 'list' | 'detail' | undefined; actor?: UserIdentity | undefined },
  ): Promise<UserResponse[]> {
    return hydrateUsersResponseList({
      users,
      userOrgRepository: this.userOrgRepository,
      findProfilesByUserIds: (uids) => this.identityBridge.findProfilesByUserIds(uids),
      findCredentialsByUserIds: (uids) => this.identityBridge.findCredentialsByUserIds(uids),
      rolesPublicService: this.rolesPublicService,
      organizationsPublicService: this.organizationsPublicService,
      mapper: this.mapper,
      decryptPhone: (p) => this.identityBridge.decryptPhone(p),
      viewMode: options?.viewMode,
      actor: options?.actor,
    });
  }

  public async findActiveUserIdsByIds(userIds: readonly number[]): Promise<number[]> {
    return this.identityBridge.findActiveUserIdsByIds(userIds);
  }

  public async findActiveUserIdsByRoleIds(roleIds: readonly number[]): Promise<number[]> {
    return this.identityBridge.findActiveUserIdsByRoleIds(roleIds);
  }

  public async findActiveUserIdsByOrganizationUnitIds(
    unitIds: readonly number[],
  ): Promise<number[]> {
    return this.identityBridge.findActiveUserIdsByOrganizationUnitIds(unitIds);
  }

  public async findUserContactsByIds(
    userIds: readonly number[],
  ): Promise<UserNotificationContactView[]> {
    return this.identityBridge.findUserContactsByIds(userIds);
  }
}
