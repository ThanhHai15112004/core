import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ConflictAppException,
  DomainEventBusService,
  NotFoundAppException,
  PRIVILEGED_ACCESS_DOMAIN_EVENTS,
  type PaginatedResult,
  defaultDomainEventBus,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  type IPermissionsPublicService,
  PERMISSIONS_PUBLIC_SERVICE,
} from '@modules/permissions/contracts/index.js';
import {
  type IRolesPublicService,
  ROLES_PUBLIC_SERVICE,
  ROLE_STATUS,
} from '@modules/roles/contracts/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  USER_STATUS,
} from '@modules/users/contracts/index.js';
import { getBreakGlassStatusName } from '../contracts/index.js';
import { PRIVILEGED_TARGET_TYPE } from '../enum/privileged-access.enum.js';
import { mapTargetEntityToView } from '../helpers/privileged-mapper.helper.js';
import { PrivilegedAccessTargetEntity } from '../entities/privileged-access-target.entity.js';
import { PrivilegedAccessTargetRepository } from '../repositories/privileged-access-target.repository.js';
import { PrivilegedBreakGlassAccountRepository } from '../repositories/privileged-break-glass-account.repository.js';
import type {
  ListDirectoryUsersQuery,
  ListPrivilegedTargetsQuery,
  UpdatePrivilegedTargetRequest,
  UpsertPrivilegedTargetRequest,
} from '../requests/privileged-access.requests.js';
import type {
  PrivilegedTargetView,
  PrivilegedUserDirectoryItemView,
} from '../types/privileged-access.types.js';

@Injectable()
export class PrivilegedTargetsService {
  private cachedEnabledTargets: PrivilegedAccessTargetEntity[] | null = null;
  private cacheLoadedAtMs = 0;
  private static readonly CACHE_TTL_MS = 10_000;

  constructor(
    private readonly targetRepository: PrivilegedAccessTargetRepository,
    private readonly breakGlassRepository: PrivilegedBreakGlassAccountRepository,
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesService: IRolesPublicService,
    @Inject(PERMISSIONS_PUBLIC_SERVICE)
    private readonly permissionsService: IPermissionsPublicService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersService: IUsersPublicService,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService?: AuditLogService,
    @Optional()
    private readonly domainEventBus: DomainEventBusService = defaultDomainEventBus,
  ) {}

  public invalidateCache(): void {
    this.cachedEnabledTargets = null;
    this.cacheLoadedAtMs = 0;
  }

  public async getEnabledTargetsCached(): Promise<PrivilegedAccessTargetEntity[]> {
    const now = Date.now();
    if (
      this.cachedEnabledTargets &&
      now - this.cacheLoadedAtMs < PrivilegedTargetsService.CACHE_TTL_MS
    ) {
      return this.cachedEnabledTargets;
    }
    const items = await this.targetRepository.findAllEnabled();
    this.cachedEnabledTargets = items;
    this.cacheLoadedAtMs = now;
    return items;
  }

  public async findTargetByTypeAndCode(
    targetType: 'ROLE' | 'PERMISSION',
    targetCode: string,
  ): Promise<PrivilegedAccessTargetEntity | null> {
    return this.targetRepository.findByTypeAndCode(targetType, targetCode);
  }

  public async listTargets(
    query: ListPrivilegedTargetsQuery,
  ): Promise<PaginatedResult<PrivilegedTargetView>> {
    const res = await this.targetRepository.paginateFiltered({
      targetType: query.targetType,
      isEnabled: query.isEnabled,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
    return createPaginatedResult(
      res.data.map(mapTargetEntityToView),
      res.meta.total,
      res.meta.page,
      res.meta.limit,
    );
  }

  public async upsertTarget(
    dto: UpsertPrivilegedTargetRequest,
    actor?: UserIdentity,
  ): Promise<PrivilegedTargetView> {
    const targetCode = dto.targetCode.trim();
    if (dto.targetType === PRIVILEGED_TARGET_TYPE.ROLE) {
      const roles = await this.rolesService.findByCodes([targetCode]);
      if (roles.length === 0) {
        throw new NotFoundAppException('privileged-access.roleNotFound', { code: targetCode });
      }
    } else {
      const perms = await this.permissionsService.findByCodes([targetCode]);
      if (perms.length === 0) {
        throw new NotFoundAppException('privileged-access.permissionNotFound', {
          code: targetCode,
        });
      }
    }

    const existing = await this.targetRepository.findByTypeAndCode(dto.targetType, targetCode);
    const beforeData = existing ? mapTargetEntityToView(existing) : null;

    const entity =
      existing ??
      this.targetRepository.create({
        targetType: dto.targetType,
        targetCode,
        createdBy: actor?.id ?? null,
      });

    entity.displayName = dto.displayName.trim();
    entity.description = dto.description?.trim() ?? null;
    entity.sensitivityLevel = dto.sensitivityLevel;
    entity.requireMfaStepUp = dto.requireMfaStepUp;
    entity.requireApproval = dto.requireApproval;
    entity.autoApproveAllowed = dto.autoApproveAllowed;
    entity.maxGrantMinutes = dto.maxGrantMinutes;
    entity.alertOnUse = dto.alertOnUse;
    entity.reviewIntervalDays = dto.reviewIntervalDays;
    entity.isEnabled = dto.isEnabled;
    entity.updatedBy = actor?.id ?? null;

    const saved = await this.targetRepository.saveEntity(entity);
    this.invalidateCache();

    const view = mapTargetEntityToView(saved);
    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_targets',
          action: existing ? 'pam.target.update' : 'pam.target.create',
          resourceType: 'privileged_access_targets',
          resourceId: String(saved.id),
          actor: actor ?? null,
          beforeData,
          afterData: view,
        })
        .catch(() => undefined);
    }
    await this.domainEventBus
      .publish({
        type: PRIVILEGED_ACCESS_DOMAIN_EVENTS.TARGET_UPDATED,
        sourceModule: 'privileged-access',
        aggregateType: 'PrivilegedAccessTarget',
        aggregateId: String(saved.id),
        payload: {
          targetType: saved.targetType,
          targetCode: saved.targetCode,
          isEnabled: saved.isEnabled,
        },
      })
      .catch(() => undefined);

    return view;
  }

  public async updateTarget(
    id: number,
    dto: UpdatePrivilegedTargetRequest,
    actor?: UserIdentity,
  ): Promise<PrivilegedTargetView> {
    const existing = await this.targetRepository.findById(id);
    if (!existing) {
      throw new NotFoundAppException('privileged-access.targetNotFound');
    }
    const beforeData = mapTargetEntityToView(existing);

    if (dto.displayName !== undefined) existing.displayName = dto.displayName.trim();
    if (dto.description !== undefined) existing.description = dto.description?.trim() ?? null;
    if (dto.sensitivityLevel !== undefined) existing.sensitivityLevel = dto.sensitivityLevel;
    if (dto.requireMfaStepUp !== undefined) existing.requireMfaStepUp = dto.requireMfaStepUp;
    if (dto.requireApproval !== undefined) existing.requireApproval = dto.requireApproval;
    if (dto.autoApproveAllowed !== undefined) existing.autoApproveAllowed = dto.autoApproveAllowed;
    if (dto.maxGrantMinutes !== undefined) existing.maxGrantMinutes = dto.maxGrantMinutes;
    if (dto.alertOnUse !== undefined) existing.alertOnUse = dto.alertOnUse;
    if (dto.reviewIntervalDays !== undefined) existing.reviewIntervalDays = dto.reviewIntervalDays;
    if (dto.isEnabled !== undefined) existing.isEnabled = dto.isEnabled;
    existing.updatedBy = actor?.id ?? null;

    const saved = await this.targetRepository.saveEntity(existing);
    this.invalidateCache();
    const view = mapTargetEntityToView(saved);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_targets',
          action: 'pam.target.update',
          resourceType: 'privileged_access_targets',
          resourceId: String(saved.id),
          actor: actor ?? null,
          beforeData,
          afterData: view,
        })
        .catch(() => undefined);
    }

    return view;
  }

  public async deleteTarget(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const existing = await this.targetRepository.findById(id);
    if (!existing) {
      throw new NotFoundAppException('privileged-access.targetNotFound');
    }
    if (!existing.isEnabled && existing.deletedAt) {
      throw new ConflictAppException('privileged-access.targetNotFound');
    }
    const beforeData = mapTargetEntityToView(existing);
    await this.targetRepository.softDeleteEntity(existing);
    this.invalidateCache();

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_targets',
          action: 'pam.target.delete',
          resourceType: 'privileged_access_targets',
          resourceId: String(existing.id),
          actor: actor ?? null,
          beforeData,
        })
        .catch(() => undefined);
    }

    return { deleted: true, id: Number(existing.id) };
  }

  /**
   * Liệt kê danh sách người dùng hiện có từ bảng `users`, đối chiếu trực tiếp với các vai trò đặc biệt
   * (`privileged_access_targets`) và tài khoản Break-glass (`privileged_break_glass_accounts`) để hỗ trợ
   * liên kết trực tiếp user admin đặc biệt đã tạo sẵn trong hệ thống.
   */
  public async listExistingUsersDirectory(
    query: ListDirectoryUsersQuery,
  ): Promise<PaginatedResult<PrivilegedUserDirectoryItemView>> {
    const [enabledTargets, breakGlassList] = await Promise.all([
      this.getEnabledTargetsCached(),
      this.breakGlassRepository.findAll(),
    ]);
    const privilegedRoleSet = new Set(
      enabledTargets
        .filter((t) => t.targetType === PRIVILEGED_TARGET_TYPE.ROLE)
        .map((t) => t.targetCode),
    );
    const bgByUserId = new Map(breakGlassList.map((bg) => [Number(bg.userId), bg]));

    if (query.privilegedOnly) {
      const standing = await this.listStandingPrivilegedUsers();
      const searchTerm = query.q?.trim().toLowerCase() ?? '';
      const filtered = searchTerm
        ? standing.filter(
            (u) =>
              u.username.toLowerCase().includes(searchTerm) ||
              u.email.toLowerCase().includes(searchTerm) ||
              u.fullName.toLowerCase().includes(searchTerm),
          )
        : standing;
      const page = query.page ?? 1;
      const limit = query.limit ?? 50;
      const offset = (page - 1) * limit;
      return createPaginatedResult(
        filtered.slice(offset, offset + limit),
        filtered.length,
        page,
        limit,
      );
    }

    if (!this.usersService.listProvisionedUsers) {
      return createPaginatedResult([], 0, query.page ?? 1, query.limit ?? 50);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const res = await this.usersService.listProvisionedUsers({
      q: query.q,
      page,
      limit,
    });

    const items: PrivilegedUserDirectoryItemView[] = res.items.map((u) => {
      const privilegedRoles = u.roles
        .map((r) => r.code)
        .filter((code) => privilegedRoleSet.has(code));
      const bg = bgByUserId.get(Number(u.id));
      return {
        id: Number(u.id),
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        status: Number(u.status),
        statusName: u.statusName,
        roles: u.roles.map((r) => ({ roleId: Number(r.roleId), code: r.code, name: r.name })),
        privilegedRoleCodes: privilegedRoles,
        isStandingPrivileged: privilegedRoles.length > 0,
        isLinkedBreakGlass: Boolean(bg),
        breakGlassCode: bg?.code ?? null,
        breakGlassStatus: bg ? getBreakGlassStatusName(bg.status) : null,
      };
    });

    return createPaginatedResult(items, res.total, page, limit);
  }

  /**
   * Tổng hợp toàn bộ user đang giữ vai trò đặc biệt cố định (Standing Privileged Admins) từ bảng `users` + `user_roles`,
   * bao gồm cả các tài khoản admin đặc biệt do người dùng tự tạo thêm trong bảng `users`.
   */
  public async listStandingPrivilegedUsers(): Promise<PrivilegedUserDirectoryItemView[]> {
    const enabledTargets = await this.getEnabledTargetsCached();
    const roleTargetCodes = enabledTargets
      .filter((t) => t.targetType === PRIVILEGED_TARGET_TYPE.ROLE)
      .map((t) => t.targetCode);
    if (roleTargetCodes.length === 0) return [];

    const [roles, breakGlassList] = await Promise.all([
      this.rolesService.findByCodes(roleTargetCodes),
      this.breakGlassRepository.findAll(),
    ]);
    const activeRoleIds = roles
      .filter((r) => Number(r.status) === ROLE_STATUS.ACTIVE)
      .map((r) => Number(r.id));
    if (activeRoleIds.length === 0 || !this.rolesService.findUserIdsByRoleIds) {
      return [];
    }

    const userIds = await this.rolesService.findUserIdsByRoleIds(activeRoleIds);
    if (userIds.length === 0 || !this.usersService.getProvisionedUserById) {
      return [];
    }

    const privilegedRoleSet = new Set(roleTargetCodes);
    const bgByUserId = new Map(breakGlassList.map((bg) => [Number(bg.userId), bg]));

    const hydrated = await Promise.all(
      userIds.map((uid) =>
        this.usersService.getProvisionedUserById!(Number(uid)).catch(() => null),
      ),
    );

    const result: PrivilegedUserDirectoryItemView[] = [];
    for (const u of hydrated) {
      if (!u || Number(u.status) === USER_STATUS.ARCHIVED) continue;
      const privilegedRoles = u.roles
        .map((r) => r.code)
        .filter((code) => privilegedRoleSet.has(code));
      if (privilegedRoles.length === 0) continue;
      const bg = bgByUserId.get(Number(u.id));
      result.push({
        id: Number(u.id),
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        status: Number(u.status),
        statusName: u.statusName,
        roles: u.roles.map((r) => ({ roleId: Number(r.roleId), code: r.code, name: r.name })),
        privilegedRoleCodes: privilegedRoles,
        isStandingPrivileged: true,
        isLinkedBreakGlass: Boolean(bg),
        breakGlassCode: bg?.code ?? null,
        breakGlassStatus: bg ? getBreakGlassStatusName(bg.status) : null,
      });
    }

    return result.sort((a, b) => a.id - b.id);
  }
}
