import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  SettingRegistryService,
  defaultCodeRegistry,
  defaultMenuRegistry,
  defaultSettingRegistry,
  pickSelectedFields,
  resolvePagination,
  scanModuleManifests,
} from '@packages/kernel/index.js';
import { TransactionManager } from '@packages/database/index.js';
import {
  AuditLogService,
  type AuditLogPaginatedResult,
  type AuditLogQueryFilter,
  type AuditLogRecord,
  DataScopeService,
  type DataScopeCustomRuleMetadata,
  PlatformSecurityService,
  type SecurityAnomalyAlert,
  type SecurityEventRecord,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  DATA_SCOPE,
  type DataScopeCode,
  type IRolesPublicService,
  type ModulePermissionDeclaration,
  type ModulePermissionsManifestInput,
  PERMISSION_STATUS,
  ROLE_STATUS,
  type RoleAssignedUserSummary,
  type RoleSummary,
  inferDefaultDataScopeForRoleCode,
  parseDataScope,
  parseRoleStatus,
} from '../contracts/index.js';
import { ROLES_AUDIT_META, ROLES_CODE_TYPES, ROLES_SETTING_KEYS } from '../enum/roles.enum.js';
import type {
  DeclarativeCustomScopeRuleInput,
  EffectiveDataScopeOverview,
  NormalizedPermissionDeclaration,
  SecurityAlertsQueryFilter,
  SecurityEventsQueryFilter,
} from '../types/roles.types.js';
import {
  buildDeclaredPermissionsMap,
  buildOrphanedPermissionWarnings,
  buildRolePermissionMatrix,
  groupPermissionCatalogItems,
  mapPermissionsToCatalogItems,
} from '../helpers/role-permission-catalog.helper.js';
import {
  assertDataScopeAllAllowedForRole,
  buildFallbackEffectiveDataScope,
  createDeclarativeScopeEvaluateFn,
} from '../helpers/role-data-scope.helper.js';
import type { PermissionEntity } from '../entities/permission.entity.js';
import { PermissionRepository } from '../repositories/permission.repository.js';
import { RoleRepository } from '../repositories/role.repository.js';
import { RolePermissionRepository } from '../repositories/role-permission.repository.js';
import { RolesMapper } from '../mappers/roles.mapper.js';
import type {
  CloneRoleRequest,
  CreateRoleRequest,
  ListAuditLogsQuery,
  ListRolesQuery,
  SetRolePermissionsRequest,
  SyncPermissionsRequest,
  UpdateRoleRequest,
} from '../requests/roles.requests.js';
import type {
  OrphanedPermissionWarningResponse,
  PermissionCatalogItemResponse,
  PermissionFunctionalGroupResponse,
  RoleAssignedUserResponse,
  RolePermissionMatrixResponse,
  RoleResponse,
  SyncPermissionsResultResponse,
} from '../responses/roles.response.js';

@Injectable()
export class RolesService implements IRolesPublicService {
  private roleUserCountDelegate?: (roleIds: readonly number[]) => Promise<Map<number, number>>;
  private roleUsersListDelegate?: (roleId: number) => Promise<RoleAssignedUserSummary[]>;
  private readonly registeredModules = new Map<string, ModulePermissionsManifestInput>();
  private customActiveModulesOverride: Map<string, ModulePermissionsManifestInput> | null = null;
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly rolePermissionRepository: RolePermissionRepository,
    private readonly mapper: RolesMapper,
    private readonly permissionRepository: PermissionRepository,
    @Optional()
    @Inject(TransactionManager)
    private readonly transactionManager: TransactionManager | null = null,
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
    settingRegistry?: SettingRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.initializeModuleManifests();
    this.dataScopeService?.registerRoleScopeResolver(async (roleCodes) => {
      const roles = await this.findByCodes(roleCodes);
      return roles.filter((r) => r.status === ROLE_STATUS.ACTIVE).map((r) => r.dataScope);
    });
    defaultMenuRegistry.registerRolePermissionsResolver(async (roleCodes) => {
      const roles = await this.findByCodes(roleCodes);
      const perms = new Set<string>();
      for (const role of roles) {
        if (role.status === ROLE_STATUS.ACTIVE) {
          for (const permCode of role.permissions) {
            perms.add(permCode);
          }
        }
      }
      return [...perms];
    });
    defaultCodeRegistry.registerUsageChecker(
      ROLES_CODE_TYPES.STATUS,
      ROLES_CODE_TYPES.STATUS,
      async ({ numericCode }) => {
        const roles = await this.roleRepository.findFiltered({});
        return roles.filter((r) => !r.deletedAt && Number(r.status) === Number(numericCode)).length;
      },
    );
    defaultCodeRegistry.registerUsageChecker(
      ROLES_CODE_TYPES.DATA_SCOPE,
      ROLES_CODE_TYPES.DATA_SCOPE,
      async ({ numericCode }) => {
        const roles = await this.roleRepository.findFiltered({});
        return roles.filter((r) => !r.deletedAt && Number(r.dataScope) === Number(numericCode))
          .length;
      },
    );
  }

  /** Đăng ký hàm ủy quyền từ module Users để đếm số người dùng đang giữ từng vai trò */
  public registerRoleUserCountDelegate(
    delegate: (roleIds: readonly number[]) => Promise<Map<number, number>>,
  ): void {
    this.roleUserCountDelegate = delegate;
  }

  /** Đăng ký hàm ủy quyền từ module Users để lấy danh sách người dùng đang giữ một vai trò */
  public registerRoleUsersListDelegate(
    delegate: (roleId: number) => Promise<RoleAssignedUserSummary[]>,
  ): void {
    this.roleUsersListDelegate = delegate;
  }

  /** Đăng ký danh sách quyền công bố của một module (Mục 4.2 — Mỗi module tự công bố quyền của mình) */
  public registerModulePermissions(input: ModulePermissionsManifestInput): void {
    const moduleKey = input.module.trim().toLowerCase();
    if (!moduleKey) return;
    this.registeredModules.set(moduleKey, {
      module: moduleKey,
      displayName: input.displayName?.trim() || input.module,
      permissions: input.permissions,
    });
  }

  /** Lấy danh sách vai trò kèm danh sách quyền và số lượng người đang sử dụng của từng vai trò */
  public async list(query: ListRolesQuery = {}): Promise<RoleResponse[]> {
    const roles = await this.roleRepository.findFiltered(query);
    if (roles.length === 0) return [];

    const roleIds = roles.map((r) => Number(r.id));
    const [permsMap, countsMap] = await Promise.all([
      this.loadPermissionsMap(roleIds),
      this.loadUserCountsMap(roleIds),
    ]);
    const items = roles.map((role) =>
      this.mapper.toResponse(
        role,
        permsMap.get(Number(role.id)) ?? [],
        countsMap.get(Number(role.id)) ?? 0,
      ),
    );
    if (query.fields && query.fields.length > 0) {
      return pickSelectedFields(items, query.fields) as unknown as RoleResponse[];
    }
    return items;
  }

  /** Lấy thông tin chi tiết một vai trò theo ID */
  public async getById(id: number): Promise<RoleResponse> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }
    const roleId = Number(role.id);
    const [permsMap, countsMap] = await Promise.all([
      this.loadPermissionsMap([roleId]),
      this.loadUserCountsMap([roleId]),
    ]);
    return this.mapper.toResponse(role, permsMap.get(roleId) ?? [], countsMap.get(roleId) ?? 0);
  }

  /** Xem danh sách người dùng đang sử dụng vai trò (Mục 4.1 — kiểm tra trước khi thay đổi hoặc xóa) */
  public async listAssignedUsers(roleId: number): Promise<RoleAssignedUserResponse[]> {
    const role = await this.roleRepository.findById(roleId);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id: roleId });
    }
    if (!this.roleUsersListDelegate) {
      return [];
    }
    return this.roleUsersListDelegate(Number(role.id));
  }

  /** Lấy danh mục quyền hạn hệ thống từ bảng permissions kèm nhóm chức năng và cờ cảnh báo quyền mồ côi (Mục 4.2) */
  public async listPermissionsCatalog(): Promise<PermissionCatalogItemResponse[]> {
    const perms = await this.permissionRepository.findAll();
    const declaredMap = this.getActiveDeclaredPermissionsMap();
    return mapPermissionsToCatalogItems(perms, declaredMap);
  }

  /** Nhóm danh mục quyền theo module và nhóm chức năng (Mục 4.2 — Nhóm quyền theo chức năng dễ chọn và quản lý) */
  public async listPermissionsGrouped(): Promise<PermissionFunctionalGroupResponse[]> {
    const catalog = await this.listPermissionsCatalog();
    return groupPermissionCatalogItems(catalog, this.getActiveModulesMap());
  }

  /** Đồng bộ quyền idempotent từ các module manifests vào bảng permissions (Mục 4.2 — Không tạo trùng quyền) */
  public async syncModulePermissions(
    input?: SyncPermissionsRequest | readonly ModulePermissionsManifestInput[],
  ): Promise<SyncPermissionsResultResponse> {
    let modulesInput: readonly ModulePermissionsManifestInput[] | undefined;
    let replaceActiveModules = false;

    if (Array.isArray(input)) {
      modulesInput = input;
    } else if (input && typeof input === 'object') {
      const req = input as SyncPermissionsRequest;
      modulesInput = req.modules;
      replaceActiveModules = Boolean(req.replaceActiveModules);
    }

    if (modulesInput && modulesInput.length > 0) {
      if (replaceActiveModules) {
        const overrideMap = new Map<string, ModulePermissionsManifestInput>();
        for (const mod of modulesInput) {
          const key = mod.module.trim().toLowerCase();
          if (!key) continue;
          overrideMap.set(key, {
            module: key,
            displayName: mod.displayName?.trim() || mod.module,
            permissions: mod.permissions,
          });
        }
        this.customActiveModulesOverride = overrideMap;
      } else {
        this.customActiveModulesOverride = null;
        for (const mod of modulesInput) {
          this.registerModulePermissions(mod);
        }
      }
    } else if (replaceActiveModules) {
      this.customActiveModulesOverride = null;
    }

    const declaredMap = this.getActiveDeclaredPermissionsMap();
    const activeModules = this.getActiveModulesMap();
    const declaredItems = [...declaredMap.values()];

    const { createdCodes, updatedCodes, unchangedCount } =
      await this.permissionRepository.upsertCatalogItems(
        declaredItems.map((item) => ({
          code: item.code,
          name: item.name,
          module: item.module,
          description: item.description,
        })),
      );

    const allAfter = await this.permissionRepository.findAll();
    const orphanedCodes = allAfter
      .map((p) => p.code.trim().toLowerCase())
      .filter((code) => !declaredMap.has(code));

    return {
      totalDeclared: declaredItems.length,
      createdCount: createdCodes.length,
      updatedCount: updatedCodes.length,
      unchangedCount,
      orphanedCount: orphanedCodes.length,
      createdCodes,
      updatedCodes,
      orphanedCodes,
      syncedModules: [...activeModules.keys()],
    };
  }

  /** Cảnh báo danh sách quyền mồ côi không còn thuộc bất kỳ module hoạt động nào (Mục 4.2 — Tránh permission rác) */
  public async listOrphanedPermissions(): Promise<OrphanedPermissionWarningResponse[]> {
    const allPerms = await this.permissionRepository.findAll();
    const declaredMap = this.getActiveDeclaredPermissionsMap();
    const orphanedPerms = allPerms.filter((p) => !declaredMap.has(p.code.trim().toLowerCase()));
    if (orphanedPerms.length === 0) return [];

    const roles = await this.roleRepository.findFiltered({});
    const roleIds = roles.map((r) => Number(r.id));
    const permsMap = await this.loadPermissionsMap(roleIds);

    return buildOrphanedPermissionWarnings(orphanedPerms, roles, permsMap);
  }

  /** Tạo bảng ma trận tổng hợp Vai trò × Quyền toàn hệ thống (Mục 4.2 — Dễ rà soát quyền toàn hệ thống) */
  public async getPermissionMatrix(): Promise<RolePermissionMatrixResponse> {
    const [roles, catalog] = await Promise.all([
      this.roleRepository.findFiltered({}),
      this.listPermissionsCatalog(),
    ]);
    const roleIds = roles.map((r) => Number(r.id));
    const permsMap = await this.loadPermissionsMap(roleIds);

    return buildRolePermissionMatrix(roles, catalog, permsMap, (role, perms) =>
      this.mapper.toSummary(role, perms),
    );
  }

  /** Tạo mới vai trò và gán quyền (hỗ trợ cả permissionIds, permissions codes và dataScope — Mục 4.1 & 4.3) */
  public async create(dto: CreateRoleRequest): Promise<RoleResponse> {
    const normalizedCode = dto.code.trim().toLowerCase();
    const existing = await this.roleRepository.findByCode(normalizedCode);
    if (existing) {
      throw new ConflictAppException(
        'roles.duplicateCode',
        [{ code: normalizedCode }],
        { code: normalizedCode },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const resolvedDataScope =
      dto.dataScope !== undefined
        ? parseDataScope(dto.dataScope)
        : inferDefaultDataScopeForRoleCode(normalizedCode);

    const work = async (): Promise<RoleResponse> => {
      const resolvedPerms = await this.resolveInputPermissions(dto.permissionIds, dto.permissions);
      assertDataScopeAllAllowedForRole({
        roleCode: normalizedCode,
        dataScope: resolvedDataScope,
        permissionCodes: resolvedPerms.map((p) => p.code),
        settingRegistry: this.settingRegistry,
      });

      const saved = await this.roleRepository.saveEntity({
        code: normalizedCode,
        name: dto.name.trim(),
        description: dto.description ?? null,
        isSystem: false,
        dataScope: resolvedDataScope,
        status: parseRoleStatus(dto.status),
      });

      await this.rolePermissionRepository.replacePermissionsForRole(
        Number(saved.id),
        resolvedPerms.map((p) => Number(p.id)),
      );
      const createdResponse = this.mapper.toResponse(saved, resolvedPerms, 0);
      await this.auditLogService?.record({
        module: ROLES_AUDIT_META.MODULE,
        feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
        action: ROLES_AUDIT_META.ACTION_CREATED,
        resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
        resourceId: createdResponse.id,
        beforeData: null,
        afterData: createdResponse,
      });
      return createdResponse;
    };

    if (this.transactionManager) {
      return this.transactionManager.runInTransaction(work);
    }
    return work();
  }

  /** Sao chép vai trò: Tạo vai trò mới kế thừa toàn bộ quyền và phạm vi dữ liệu từ một vai trò hiện có (Mục 4.1 & 4.3) */
  public async clone(sourceRoleId: number, dto: CloneRoleRequest): Promise<RoleResponse> {
    const sourceRole = await this.roleRepository.findById(sourceRoleId);
    if (!sourceRole) {
      throw new NotFoundAppException('roles.notFound', { id: sourceRoleId });
    }

    const normalizedCode = dto.code.trim().toLowerCase();
    const existing = await this.roleRepository.findByCode(normalizedCode);
    if (existing) {
      throw new ConflictAppException(
        'roles.duplicateCode',
        [{ code: normalizedCode }],
        { code: normalizedCode },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const sourcePermsMap = await this.loadPermissionsMap([Number(sourceRole.id)]);
    const sourcePerms = sourcePermsMap.get(Number(sourceRole.id)) ?? [];

    const resolvedDescription =
      dto.description !== undefined
        ? dto.description
        : sourceRole.description
          ? `${sourceRole.description} (Cloned from ${sourceRole.code})`
          : `Cloned from role ${sourceRole.code}`;

    const resolvedDataScope =
      dto.dataScope !== undefined
        ? parseDataScope(dto.dataScope)
        : parseDataScope(sourceRole.dataScope, inferDefaultDataScopeForRoleCode(sourceRole.code));

    const work = async (): Promise<RoleResponse> => {
      const saved = await this.roleRepository.saveEntity({
        code: normalizedCode,
        name: dto.name.trim(),
        description: resolvedDescription,
        isSystem: false,
        dataScope: resolvedDataScope,
        status: parseRoleStatus(dto.status),
      });

      await this.rolePermissionRepository.replacePermissionsForRole(
        Number(saved.id),
        sourcePerms.map((p) => Number(p.id)),
      );
      const clonedResponse = this.mapper.toResponse(saved, sourcePerms, 0);
      await this.auditLogService?.record({
        module: ROLES_AUDIT_META.MODULE,
        feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
        action: ROLES_AUDIT_META.ACTION_CLONED,
        resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
        resourceId: clonedResponse.id,
        beforeData: { sourceRoleId, sourceRoleCode: sourceRole.code },
        afterData: clonedResponse,
        reason: `Cloned from role ${sourceRole.code}`,
      });
      return clonedResponse;
    };

    if (this.transactionManager) {
      return this.transactionManager.runInTransaction(work);
    }
    return work();
  }

  /** Cập nhật thông tin vai trò (tên, mô tả, phạm vi dữ liệu dataScope, trạng thái — giữ nguyên mã code) và danh sách quyền */
  public async update(id: number, dto: UpdateRoleRequest): Promise<RoleResponse> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }

    if (role.isSystem && dto.status === ROLE_STATUS.INACTIVE) {
      throw new ForbiddenAppException('roles.cannotDeactivateSystemRole', [{ code: role.code }]);
    }

    const countsMap = await this.loadUserCountsMap([Number(role.id)]);
    const userCount = countsMap.get(Number(role.id)) ?? 0;
    const beforePermsMap = await this.loadPermissionsMap([Number(role.id)]);
    const beforePerms = beforePermsMap.get(Number(role.id)) ?? [];
    const beforeSnapshot = this.mapper.toResponse(
      { ...role } as typeof role,
      beforePerms,
      userCount,
    );

    const work = async (): Promise<RoleResponse> => {
      if (dto.name !== undefined) role.name = dto.name.trim();
      if (dto.description !== undefined) role.description = dto.description;
      if (dto.dataScope !== undefined) role.dataScope = parseDataScope(dto.dataScope);
      if (dto.status !== undefined) role.status = dto.status;

      if (dto.permissionIds !== undefined || dto.permissions !== undefined) {
        const resolvedPerms = await this.resolveInputPermissions(
          dto.permissionIds,
          dto.permissions,
        );
        if (dto.dataScope !== undefined) {
          assertDataScopeAllAllowedForRole({
            roleCode: role.code,
            dataScope: role.dataScope,
            permissionCodes: resolvedPerms.map((p) => p.code),
            isSystem: role.isSystem,
            settingRegistry: this.settingRegistry,
          });
        }
        const saved = await this.roleRepository.saveEntity(role);
        await this.rolePermissionRepository.replacePermissionsForRole(
          Number(saved.id),
          resolvedPerms.map((p) => Number(p.id)),
        );
        const updatedResponse = this.mapper.toResponse(saved, resolvedPerms, userCount);
        await this.auditLogService?.record({
          module: ROLES_AUDIT_META.MODULE,
          feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
          action: ROLES_AUDIT_META.ACTION_UPDATED,
          resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
          resourceId: updatedResponse.id,
          beforeData: beforeSnapshot,
          afterData: updatedResponse,
        });
        await this.platformSecurityService?.recordSecurityEvent({
          eventType: 'PERMISSION_CHANGED',
          module: ROLES_AUDIT_META.MODULE,
          feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
          action: ROLES_AUDIT_META.ACTION_UPDATED,
          resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
          resourceId: updatedResponse.id,
          reason: `Updated role ${updatedResponse.code} permissions/scope`,
          beforeData: beforeSnapshot,
          afterData: updatedResponse,
          persistToAuditLog: false,
        });
        return updatedResponse;
      }

      if (dto.dataScope !== undefined) {
        assertDataScopeAllAllowedForRole({
          roleCode: role.code,
          dataScope: role.dataScope,
          permissionCodes: beforePerms.map((p) => p.code),
          isSystem: role.isSystem,
          settingRegistry: this.settingRegistry,
        });
      }
      const saved = await this.roleRepository.saveEntity(role);
      const updatedResponse = this.mapper.toResponse(saved, beforePerms, userCount);
      await this.auditLogService?.record({
        module: ROLES_AUDIT_META.MODULE,
        feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
        action: ROLES_AUDIT_META.ACTION_UPDATED,
        resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
        resourceId: updatedResponse.id,
        beforeData: beforeSnapshot,
        afterData: updatedResponse,
      });
      if (dto.dataScope !== undefined) {
        await this.platformSecurityService?.recordSecurityEvent({
          eventType: 'PERMISSION_CHANGED',
          module: ROLES_AUDIT_META.MODULE,
          feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
          action: ROLES_AUDIT_META.ACTION_UPDATED,
          resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
          resourceId: updatedResponse.id,
          reason: `Updated role ${updatedResponse.code} data scope`,
          beforeData: beforeSnapshot,
          afterData: updatedResponse,
          persistToAuditLog: false,
        });
      }
      return updatedResponse;
    };

    if (this.transactionManager) {
      const result = await this.transactionManager.runInTransaction(work);
      defaultMenuRegistry.invalidateCache();
      return result;
    }
    const result = await work();
    defaultMenuRegistry.invalidateCache();
    return result;
  }

  /** Cập nhật riêng danh sách quyền hạn cho một vai trò */
  public async setPermissions(id: number, dto: SetRolePermissionsRequest): Promise<RoleResponse> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }

    const [beforePermsMap, resolvedPerms, countsMap] = await Promise.all([
      this.loadPermissionsMap([Number(role.id)]),
      this.resolveInputPermissions(dto.permissionIds, dto.permissions),
      this.loadUserCountsMap([Number(role.id)]),
    ]);
    const beforePerms = beforePermsMap.get(Number(role.id)) ?? [];

    assertDataScopeAllAllowedForRole({
      roleCode: role.code,
      dataScope: Number(role.dataScope ?? DATA_SCOPE.SELF),
      permissionCodes: resolvedPerms.map((p) => p.code),
      isSystem: Boolean(role.isSystem),
      settingRegistry: this.settingRegistry,
    });

    const work = async (): Promise<void> => {
      await this.rolePermissionRepository.replacePermissionsForRole(
        Number(role.id),
        resolvedPerms.map((p) => Number(p.id)),
      );
    };
    if (this.transactionManager) {
      await this.transactionManager.runInTransaction(work);
    } else {
      await work();
    }
    const response = this.mapper.toResponse(
      role,
      resolvedPerms,
      countsMap.get(Number(role.id)) ?? 0,
    );
    await this.auditLogService?.record({
      module: ROLES_AUDIT_META.MODULE,
      feature: ROLES_AUDIT_META.FEATURE_ROLE_PERMISSIONS,
      action: ROLES_AUDIT_META.ACTION_PERMISSIONS_UPDATED,
      resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
      resourceId: role.id,
      beforeData: { permissions: beforePerms.map((p) => p.code) },
      afterData: { permissions: resolvedPerms.map((p) => p.code) },
    });
    await this.platformSecurityService?.recordSecurityEvent({
      eventType: 'PERMISSION_CHANGED',
      module: ROLES_AUDIT_META.MODULE,
      feature: ROLES_AUDIT_META.FEATURE_ROLE_PERMISSIONS,
      action: ROLES_AUDIT_META.ACTION_PERMISSIONS_UPDATED,
      resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
      resourceId: role.id,
      reason: `Updated permissions for role ${role.code}`,
      beforeData: { permissions: beforePerms.map((p) => p.code) },
      afterData: { permissions: resolvedPerms.map((p) => p.code) },
      persistToAuditLog: false,
    });
    defaultMenuRegistry.invalidateCache();
    return response;
  }

  /** Xóa mềm vai trò (chặn xóa đối với vai trò hệ thống isSystem = true hoặc vai trò đang có người dùng sử dụng) */
  public async remove(id: number): Promise<{ deleted: true; id: number }> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }
    if (role.isSystem) {
      throw new ForbiddenAppException('roles.cannotDeleteSystemRole', [{ code: role.code }]);
    }

    const countsMap = await this.loadUserCountsMap([Number(role.id)]);
    const assignedUserCount = countsMap.get(Number(role.id)) ?? 0;
    if (assignedUserCount > 0) {
      throw new ConflictAppException(
        'roles.cannotDeleteAssignedRole',
        [{ id: Number(role.id), code: role.code, userCount: assignedUserCount }],
        { id: Number(role.id), code: role.code, userCount: assignedUserCount },
        HTTP_ERROR_CODE.CONFLICT,
      );
    }

    await this.roleRepository.repository.softDelete(id);
    await this.auditLogService?.record({
      module: ROLES_AUDIT_META.MODULE,
      feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
      action: ROLES_AUDIT_META.ACTION_DELETED,
      resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
      resourceId: id,
      beforeData: { id: role.id, code: role.code, name: role.name, dataScope: role.dataScope },
      afterData: { deleted: true },
    });
    defaultMenuRegistry.invalidateCache();
    return { deleted: true, id };
  }

  /** Hợp đồng công khai: Tìm danh sách vai trò theo mảng roleIds */
  public async findByIds(roleIds: readonly number[]): Promise<RoleSummary[]> {
    const roles = await this.roleRepository.findByIds(roleIds);
    if (roles.length === 0) return [];
    const permsMap = await this.loadPermissionsMap(roles.map((r) => Number(r.id)));
    return roles.map((role) => this.mapper.toSummary(role, permsMap.get(Number(role.id)) ?? []));
  }

  /** Hợp đồng công khai: Tìm danh sách vai trò theo mảng mã code */
  public async findByCodes(codes: readonly string[]): Promise<RoleSummary[]> {
    const roles = await this.roleRepository.findByCodes(codes);
    if (roles.length === 0) return [];
    const permsMap = await this.loadPermissionsMap(roles.map((r) => Number(r.id)));
    return roles.map((role) => this.mapper.toSummary(role, permsMap.get(Number(role.id)) ?? []));
  }

  /** Hợp đồng công khai: Tổng hợp danh sách mã quyền duy nhất từ mảng roleIds */
  public async resolvePermissionsByRoleIds(roleIds: readonly number[]): Promise<string[]> {
    const activeRoles = (await this.roleRepository.findByIds(roleIds)).filter(
      (r) => Number(r.status) === ROLE_STATUS.ACTIVE,
    );
    if (activeRoles.length === 0) return [];

    const permsMap = await this.loadPermissionsMap(activeRoles.map((r) => Number(r.id)));
    const codes = new Set<string>();
    for (const r of activeRoles) {
      for (const perm of permsMap.get(Number(r.id)) ?? []) {
        codes.add(perm.code);
      }
    }
    return [...codes];
  }

  /** Hợp đồng công khai: Tổng hợp danh sách các mức DataScopeCode từ mảng roleIds (Mục 4.3) */
  public async resolveDataScopesByRoleIds(roleIds: readonly number[]): Promise<DataScopeCode[]> {
    const activeRoles = (await this.roleRepository.findByIds(roleIds)).filter(
      (r) => Number(r.status) === ROLE_STATUS.ACTIVE,
    );
    if (activeRoles.length === 0) return [DATA_SCOPE.SELF];

    const scopes = new Set<DataScopeCode>();
    for (const r of activeRoles) {
      scopes.add(parseDataScope(r.dataScope, inferDefaultDataScopeForRoleCode(r.code)));
    }
    return [...scopes].sort((a, b) => a - b);
  }

  /** Tra cứu thông tin phạm vi dữ liệu hiệu lực của tài khoản hiện tại kèm danh sách rule nghiệp vụ (Mục 4.3) */
  public async getActorEffectiveDataScope(
    actor?: UserIdentity,
    resource = 'users',
  ): Promise<EffectiveDataScopeOverview> {
    if (!this.dataScopeService) {
      return buildFallbackEffectiveDataScope(actor);
    }

    const filter = await this.dataScopeService.resolveScopeFilter(actor, resource, 'read');
    const registeredCustomRules = this.dataScopeService.listRegisteredRules();
    return { filter, registeredCustomRules };
  }

  /** Liệt kê danh sách các rule phạm vi dữ liệu riêng đã được các module nghiệp vụ đăng ký (Mục 4.3.7) */
  public listCustomScopeRules(resource?: string): DataScopeCustomRuleMetadata[] {
    if (!this.dataScopeService) return [];
    return this.dataScopeService.listRegisteredRules(resource);
  }

  /**
   * Đăng ký một rule phạm vi dữ liệu nghiệp vụ động (Mục 4.3.7 — Cho module nghiệp vụ bổ sung rule phạm vi riêng mà không sửa Core).
   */
  public registerDeclarativeCustomScopeRule(
    input: DeclarativeCustomScopeRuleInput,
  ): DataScopeCustomRuleMetadata {
    if (!this.dataScopeService) {
      throw new BadRequestAppException('roles.dataScopeServiceUnavailable');
    }

    this.dataScopeService.registerResourceRule({
      code: input.code,
      resource: input.resource,
      module: input.module ?? input.resource,
      name: input.name,
      description: input.description ?? null,
      evaluate: createDeclarativeScopeEvaluateFn(input),
    });

    const rules = this.dataScopeService.listRegisteredRules(input.resource);
    return (
      rules.find((r) => r.code === input.code.trim().toLowerCase()) ?? {
        code: input.code.trim().toLowerCase(),
        resource: input.resource.trim().toLowerCase(),
        module: (input.module ?? input.resource).trim().toLowerCase(),
        name: input.name.trim(),
        description: input.description ?? null,
        priority: 100,
      }
    );
  }

  /**
   * Tra cứu danh sách Nhật ký thao tác (Audit Log — Mục 4.4.7):
   * Hỗ trợ lọc theo người dùng, Service Account, module, chức năng, hành động, khoảng thời gian, Request ID & Correlation ID.
   */
  public async listAuditLogs(query: ListAuditLogsQuery = {}): Promise<AuditLogPaginatedResult> {
    if (!this.auditLogService) {
      const { page, limit } = resolvePagination(query, {
        settingPrefix: ROLES_SETTING_KEYS.AUDIT_LOG_PREFIX,
        defaultLimit: 20,
        maxLimit: 200,
        registry: this.settingRegistry,
      });
      return {
        data: [],
        meta: { page, limit, totalItems: 0, totalPages: 1 },
      };
    }
    return this.auditLogService.listPaginated(query as AuditLogQueryFilter);
  }

  /** Xem chi tiết một bản ghi Audit Log theo ID (Mục 4.4.7) */
  public async getAuditLogById(id: number): Promise<AuditLogRecord> {
    if (!this.auditLogService) {
      throw new NotFoundAppException('roles.auditLogNotFound', { id });
    }
    return this.auditLogService.getById(id);
  }

  /** Chặn sửa bản ghi Audit Log qua API thường để bảo vệ tính toàn vẹn (Mục 4.4.8) */
  public async updateAuditLog(id: number, payload?: unknown): Promise<never> {
    if (this.auditLogService) {
      return this.auditLogService.update(id, payload);
    }
    throw new ForbiddenAppException('security.auditLogImmutable', [{ id, operation: 'UPDATE' }]);
  }

  /** Chặn xóa bản ghi Audit Log qua API thường để bảo vệ tính toàn vẹn (Mục 4.4.8) */
  public async deleteAuditLog(id: number): Promise<never> {
    if (this.auditLogService) {
      return this.auditLogService.remove(id);
    }
    throw new ForbiddenAppException('security.auditLogImmutable', [{ id, operation: 'DELETE' }]);
  }

  /** Tra cứu danh sách Sự kiện bảo mật (Security Events — Mục 4.5.7) */
  public listSecurityEvents(filter?: SecurityEventsQueryFilter): SecurityEventRecord[] {
    return this.platformSecurityService?.listSecurityEvents(filter) ?? [];
  }

  /** Tra cứu danh sách Cảnh báo thao tác bất thường (SIEM Anomaly Alerts — Mục 4.5.8) */
  public listSecurityAlerts(filter?: SecurityAlertsQueryFilter): SecurityAnomalyAlert[] {
    return this.platformSecurityService?.listAnomalyAlerts(filter) ?? [];
  }

  /** Hợp đồng công khai: Đảm bảo toàn bộ roleIds đều tồn tại và đang ACTIVE (status = 1) */
  public async ensureActiveRolesExist(roleIds: readonly number[]): Promise<RoleSummary[]> {
    const uniqueIds = [...new Set(roleIds.map(Number))];
    if (uniqueIds.length === 0) return [];

    const roles = await this.roleRepository.findByIds(uniqueIds);
    const foundMap = new Map(roles.map((r) => [Number(r.id), r]));

    const missingIds = uniqueIds.filter((id) => !foundMap.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestAppException('roles.invalidOrMissingRoles', [{ missingIds }]);
    }

    const inactiveIds = roles
      .filter((r) => Number(r.status) !== ROLE_STATUS.ACTIVE)
      .map((r) => Number(r.id));
    if (inactiveIds.length > 0) {
      throw new BadRequestAppException('roles.inactiveRolesNotAllowed', [{ inactiveIds }]);
    }

    const permsMap = await this.loadPermissionsMap(uniqueIds);
    return roles.map((role) => this.mapper.toSummary(role, permsMap.get(Number(role.id)) ?? []));
  }

  /** Chuẩn hóa danh sách quyền từ permissionIds hoặc permissions codes thông qua bảng permissions */
  private async resolveInputPermissions(
    permissionIds?: readonly number[],
    permissionCodes?: readonly string[],
  ): Promise<PermissionEntity[]> {
    const byId = new Map<number, PermissionEntity>();
    if (permissionIds && permissionIds.length > 0) {
      const foundByIds = await this.permissionRepository.findByIds(permissionIds);
      for (const p of foundByIds) {
        byId.set(Number(p.id), p);
      }
    }

    if (permissionCodes && permissionCodes.length > 0) {
      const ensuredByCodes =
        await this.permissionRepository.ensurePermissionsByCodes(permissionCodes);
      for (const p of ensuredByCodes) {
        byId.set(Number(p.id), p);
      }
    }

    return [...byId.values()];
  }

  /** Tải bản đồ roleId -> số lượng người dùng đang giữ vai trò thông qua delegate */
  private async loadUserCountsMap(roleIds: readonly number[]): Promise<Map<number, number>> {
    if (roleIds.length === 0 || !this.roleUserCountDelegate) {
      return new Map<number, number>();
    }
    return this.roleUserCountDelegate(roleIds);
  }

  /** Tải bản đồ roleId -> danh sách PermissionEntity từ bảng role_permissions join permissions */
  private async loadPermissionsMap(
    roleIds: readonly number[],
  ): Promise<Map<number, PermissionEntity[]>> {
    const map = new Map<number, PermissionEntity[]>();
    if (roleIds.length === 0) return map;

    const links = await this.rolePermissionRepository.findByRoleIds(roleIds);
    if (links.length === 0) return map;

    const permIds = [...new Set(links.map((l) => Number(l.permissionId)))];
    const perms = await this.permissionRepository.findByIds(permIds);
    const permById = new Map(perms.map((p) => [Number(p.id), p]));

    for (const link of links) {
      const perm = permById.get(Number(link.permissionId));
      if (!perm || Number(perm.status) !== PERMISSION_STATUS.ACTIVE) continue;
      const roleId = Number(link.roleId);
      const bucket = map.get(roleId) ?? [];
      bucket.push(perm);
      map.set(roleId, bucket);
    }
    return map;
  }

  /** Khởi tạo danh sách quyền công bố động từ các tệp module.manifest.json thực tế trên đĩa */
  private initializeModuleManifests(): void {
    for (const { moduleName, raw } of scanModuleManifests<{
      name?: string;
      displayName?: string;
      permissions?: (string | ModulePermissionDeclaration)[];
    }>()) {
      if (moduleName && Array.isArray(raw.permissions)) {
        const existing = this.registeredModules.get(moduleName);
        const mergedPerms = existing
          ? [...existing.permissions, ...raw.permissions]
          : raw.permissions;
        this.registerModulePermissions({
          module: moduleName,
          displayName: raw.displayName || existing?.displayName || moduleName,
          permissions: mergedPerms,
        });
      }
    }
  }

  /** Lấy bản đồ các module đang hoạt động (hỗ trợ override khi test hoặc đồng bộ replaceActiveModules) */
  private getActiveModulesMap(): Map<string, ModulePermissionsManifestInput> {
    if (this.customActiveModulesOverride) {
      return this.customActiveModulesOverride;
    }
    return this.registeredModules;
  }

  /** Tổng hợp bản đồ mã quyền -> thông tin quyền đã chuẩn hóa từ toàn bộ các module đang hoạt động */
  private getActiveDeclaredPermissionsMap(): Map<string, NormalizedPermissionDeclaration> {
    return buildDeclaredPermissionsMap(this.getActiveModulesMap());
  }
}
