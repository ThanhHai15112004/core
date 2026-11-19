import { Inject, Injectable, Optional } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import {
  BadRequestAppException,
  NotFoundAppException,
  SettingRegistryService,
  defaultCodeRegistry,
  defaultMenuRegistry,
  defaultSettingRegistry,
  pickSelectedFields,
  scanModuleManifests,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  type AuditLogPaginatedResult,
  type AuditLogRecord,
  DataScopeService,
  type DataScopeCustomRuleMetadata,
  PlatformSecurityService,
  type SecurityAnomalyAlert,
  type SecurityEventRecord,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  type IPermissionsPublicService,
  type NormalizedPermissionDeclaration,
  PERMISSIONS_PUBLIC_SERVICE,
  type PermissionItemSummary,
} from '@modules/permissions/index.js';
import {
  type AssignUserRolesContractInput,
  DATA_SCOPE,
  type DataScopeCode,
  type IRolesPublicService,
  type ModulePermissionDeclaration,
  type ModulePermissionsManifestInput,
  PERMISSION_STATUS,
  ROLE_STATUS,
  type RoleAssignedUserSummary,
  type RoleSummary,
  type UserRoleLinkSummary,
  inferDefaultDataScopeForRoleCode,
  parseDataScope,
} from '../contracts/index.js';
import { ROLES_CODE_TYPES } from '../enum/roles.enum.js';
import type {
  DeclarativeCustomScopeRuleInput,
  EffectiveDataScopeOverview,
} from '../types/roles.types.js';
import {
  buildDeclaredPermissionsMap,
  buildOrphanedPermissionWarnings,
  buildRolePermissionMatrix,
  groupPermissionCatalogItems,
  mapPermissionsToCatalogItems,
} from '../helpers/role-permission-catalog.helper.js';
import { RoleRepository } from '../repositories/role.repository.js';
import { RolePermissionRepository } from '../repositories/role-permission.repository.js';
import { UserRoleRepository } from '../repositories/user-role.repository.js';
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
import { RoleMutationService } from './role-mutation.service.js';

type PermissionPortLike = Pick<
  IPermissionsPublicService,
  'findAll' | 'findByIds' | 'ensurePermissionsByCodes'
> &
  Partial<IPermissionsPublicService>;

@Injectable()
export class RolesService implements IRolesPublicService {
  private roleUserCountDelegate?: (roleIds: readonly number[]) => Promise<Map<number, number>>;
  private roleUsersListDelegate?: (roleId: number) => Promise<RoleAssignedUserSummary[]>;
  private userRoleAssignmentDelegate?: (
    userId: number,
    dto: AssignUserRolesContractInput,
    actorId?: number,
    actor?: UserIdentity,
  ) => Promise<unknown>;
  private readonly registeredModules = new Map<string, ModulePermissionsManifestInput>();
  private customActiveModulesOverride: Map<string, ModulePermissionsManifestInput> | null = null;
  private readonly settingRegistry: SettingRegistryService;
  private readonly mutationService: RoleMutationService;

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly rolePermissionRepository: RolePermissionRepository,
    private readonly mapper: RolesMapper,
    @Inject(PERMISSIONS_PUBLIC_SERVICE)
    private readonly permissionCatalog: PermissionPortLike,
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
    @Optional()
    @Inject(UserRoleRepository)
    private readonly userRoleRepository: UserRoleRepository | null = null,
    @Optional()
    mutationService?: RoleMutationService | null,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.mutationService =
      mutationService ??
      new RoleMutationService(
        this.roleRepository,
        this.rolePermissionRepository,
        this.mapper,
        this.transactionManager,
        this.dataScopeService,
        this.auditLogService,
        this.platformSecurityService,
        this.settingRegistry,
      );
    if (typeof this.permissionCatalog.listPermissionsCatalog !== 'function') {
      this.initializeModuleManifests();
    }
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

  /** Đăng ký hàm ủy quyền gán vai trò cho người dùng (kết hợp kiểm tra hồ sơ user, data scope, cache & audit) */
  public registerUserRoleAssignmentDelegate(
    delegate: (
      userId: number,
      dto: AssignUserRolesContractInput,
      actorId?: number,
      actor?: UserIdentity,
    ) => Promise<unknown>,
  ): void {
    this.userRoleAssignmentDelegate = delegate;
  }

  /** Hợp đồng công khai: Tìm danh sách bản ghi gán vai trò của mảng userIds (Mục 4.1) */
  public async findUserRoleLinksByUserIds(
    userIds: readonly number[],
  ): Promise<UserRoleLinkSummary[]> {
    if (!this.userRoleRepository || userIds.length === 0) return [];
    return this.userRoleRepository.findByUserIds(userIds);
  }

  /** Hợp đồng công khai: Tìm danh sách bản ghi gán vai trò thuộc mảng roleIds (Mục 4.1) */
  public async findUserRoleLinksByRoleIds(
    roleIds: readonly number[],
  ): Promise<UserRoleLinkSummary[]> {
    if (!this.userRoleRepository || roleIds.length === 0) return [];
    return this.userRoleRepository.findByRoleIds(roleIds);
  }

  /** Hợp đồng công khai: Tìm danh sách userIds đang giữ một hoặc nhiều roleIds (Mục 4.1) */
  public async findUserIdsByRoleIds(roleIds: readonly number[]): Promise<number[]> {
    if (!this.userRoleRepository || roleIds.length === 0) return [];
    return this.userRoleRepository.findUserIdsByRoleIds(roleIds);
  }

  /** Hợp đồng công khai: Thay thế toàn bộ danh sách vai trò của một người dùng trong bảng user_roles (Mục 4.1 — roles là nơi duy nhất sở hữu thao tác ghi gán role) */
  public async replaceUserRoles(
    userId: number,
    roleIds: readonly number[],
    assignedBy?: number | null,
  ): Promise<UserRoleLinkSummary[]> {
    if (!this.userRoleRepository) {
      return roleIds.map((roleId) => ({
        userId,
        roleId: Number(roleId),
        assignedBy: assignedBy ?? null,
      }));
    }
    return this.userRoleRepository.replaceUserRoles(userId, roleIds, assignedBy);
  }

  /** Gán vai trò cho người dùng (Mục 4.1 — Quản lý vai trò sở hữu thao tác gán role cho user) */
  public async assignUserRoles<T = unknown>(
    userId: number,
    dto: AssignUserRolesContractInput,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<T> {
    if (this.userRoleAssignmentDelegate) {
      return (await this.userRoleAssignmentDelegate(userId, dto, actorId, actor)) as T;
    }
    const activeRoles = await this.ensureActiveRolesExist(dto.roleIds);
    await this.replaceUserRoles(
      userId,
      activeRoles.map((r) => r.id),
      actorId ?? actor?.id ?? null,
    );
    return {
      userId,
      roles: activeRoles,
    } as unknown as T;
  }

  /** Đăng ký danh sách quyền công bố của một module (Mục 4.2 — Mỗi module tự công bố quyền của mình) */
  public registerModulePermissions(input: ModulePermissionsManifestInput): void {
    if (typeof this.permissionCatalog.registerModulePermissions === 'function') {
      this.permissionCatalog.registerModulePermissions(input);
      return;
    }
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
    if (typeof this.permissionCatalog.listPermissionsCatalog === 'function') {
      return this.permissionCatalog.listPermissionsCatalog();
    }
    const perms = await this.permissionCatalog.findAll();
    const declaredMap = this.getActiveDeclaredPermissionsMap();
    return mapPermissionsToCatalogItems(perms, declaredMap);
  }

  /** Nhóm danh mục quyền theo module và nhóm chức năng (Mục 4.2 — Nhóm quyền theo chức năng dễ chọn và quản lý) */
  public async listPermissionsGrouped(): Promise<PermissionFunctionalGroupResponse[]> {
    if (typeof this.permissionCatalog.listPermissionsGrouped === 'function') {
      return this.permissionCatalog.listPermissionsGrouped();
    }
    const catalog = await this.listPermissionsCatalog();
    return groupPermissionCatalogItems(catalog, this.getActiveModulesMap());
  }

  /** Đồng bộ quyền idempotent từ các module manifests vào bảng permissions (Mục 4.2 — Không tạo trùng quyền) */
  public async syncModulePermissions(
    input?: SyncPermissionsRequest | readonly ModulePermissionsManifestInput[],
  ): Promise<SyncPermissionsResultResponse> {
    if (typeof this.permissionCatalog.syncModulePermissions === 'function') {
      return this.permissionCatalog.syncModulePermissions(input);
    }

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

    const { createdCodes, updatedCodes, unchangedCount } = this.permissionCatalog.upsertCatalogItems
      ? await this.permissionCatalog.upsertCatalogItems(
          declaredItems.map((item) => ({
            code: item.code,
            name: item.name,
            module: item.module,
            description: item.description,
          })),
        )
      : { createdCodes: [], updatedCodes: [], unchangedCount: 0 };

    const allAfter = await this.permissionCatalog.findAll();
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
    const catalog = await this.listPermissionsCatalog();
    const orphanedPerms = catalog.filter((p) => p.isOrphaned);
    if (orphanedPerms.length === 0) return [];

    const roles = await this.roleRepository.findFiltered({});
    const roleIds = roles.map((r) => Number(r.id));
    const permsMap = await this.loadPermissionsMap(roleIds);

    return buildOrphanedPermissionWarnings(orphanedPerms, roles, permsMap);
  }

  /** Tạo bảng ma trận tổng hợp Vai trò × Quyền toàn hệ thống (Mục 4.2 — Dựng 1 chiều từ roles -> permissions, không dùng callback ngược) */
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
    return this.mutationService.create(dto, (ids, codes) =>
      this.resolveInputPermissions(ids, codes),
    );
  }

  /** Sao chép vai trò (Mục 4.1 & 4.3 — Tạo role mới từ role hiện có với toàn bộ quyền và phạm vi dữ liệu của role gốc) */
  public async clone(sourceRoleId: number, dto: CloneRoleRequest): Promise<RoleResponse> {
    return this.mutationService.clone(sourceRoleId, dto, (rids) => this.loadPermissionsMap(rids));
  }

  /** Cập nhật tên, mô tả, phạm vi dữ liệu, trạng thái và quyền hạn của vai trò (không cho phép đổi mã code — Mục 4.1 & 4.3) */
  public async update(id: number, dto: UpdateRoleRequest): Promise<RoleResponse> {
    return this.mutationService.update(
      id,
      dto,
      (rids) => this.loadPermissionsMap(rids),
      (rids) => this.loadUserCountsMap(rids),
      (ids, codes) => this.resolveInputPermissions(ids, codes),
    );
  }

  /** Cập nhật riêng danh sách quyền hạn cho một vai trò */
  public async setPermissions(id: number, dto: SetRolePermissionsRequest): Promise<RoleResponse> {
    return this.mutationService.setPermissions(
      id,
      dto,
      (rids) => this.loadPermissionsMap(rids),
      (rids) => this.loadUserCountsMap(rids),
      (ids, codes) => this.resolveInputPermissions(ids, codes),
    );
  }

  /** Xóa mềm vai trò (chặn xóa đối với vai trò hệ thống isSystem = true hoặc vai trò đang có người dùng sử dụng) */
  public async remove(id: number): Promise<{ deleted: true; id: number }> {
    return this.mutationService.remove(id, (rids) => this.loadUserCountsMap(rids));
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
    return this.mutationService.getActorEffectiveDataScope(actor, resource);
  }

  /** Liệt kê danh sách các rule phạm vi dữ liệu riêng đã được các module nghiệp vụ đăng ký (Mục 4.3.7) */
  public listCustomScopeRules(resource?: string): DataScopeCustomRuleMetadata[] {
    return this.mutationService.listCustomScopeRules(resource);
  }

  /**
   * Đăng ký một rule phạm vi dữ liệu nghiệp vụ động (Mục 4.3.7 — Cho module nghiệp vụ bổ sung rule phạm vi riêng mà không sửa Core).
   */
  public registerDeclarativeCustomScopeRule(
    input: DeclarativeCustomScopeRuleInput,
  ): DataScopeCustomRuleMetadata {
    return this.mutationService.registerDeclarativeCustomScopeRule(input);
  }

  /**
   * Tra cứu danh sách Nhật ký thao tác (Audit Log — Mục 4.4.7):
   * Ủy quyền sang AuditLogService (@packages/security).
   */
  public async listAuditLogs(query: ListAuditLogsQuery = {}): Promise<AuditLogPaginatedResult> {
    return this.mutationService.listAuditLogs(query);
  }

  /** Xem chi tiết một bản ghi Audit Log theo ID (Mục 4.4.7) */
  public async getAuditLogById(id: number): Promise<AuditLogRecord> {
    return this.mutationService.getAuditLogById(id);
  }

  /** Chặn sửa bản ghi Audit Log qua API thường để bảo vệ tính toàn vẹn (Mục 4.4.8) */
  public async updateAuditLog(id: number, payload?: unknown): Promise<never> {
    return this.mutationService.updateAuditLog(id, payload);
  }

  /** Chặn xóa bản ghi Audit Log qua API thường để bảo vệ tính toàn vẹn (Mục 4.4.8) */
  public async deleteAuditLog(id: number): Promise<never> {
    return this.mutationService.deleteAuditLog(id);
  }

  /** Tra cứu danh sách Sự kiện bảo mật (Security Events — Mục 4.5.7) */
  public listSecurityEvents(
    filter?: Parameters<PlatformSecurityService['listSecurityEvents']>[0],
  ): SecurityEventRecord[] {
    return this.mutationService.listSecurityEvents(filter);
  }

  /** Tra cứu danh sách Cảnh báo thao tác bất thường (SIEM Anomaly Alerts — Mục 4.5.8) */
  public listSecurityAlerts(
    filter?: Parameters<PlatformSecurityService['listAnomalyAlerts']>[0],
  ): SecurityAnomalyAlert[] {
    return this.mutationService.listSecurityAlerts(filter);
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
  ): Promise<PermissionItemSummary[]> {
    const byId = new Map<number, PermissionItemSummary>();
    if (permissionIds && permissionIds.length > 0) {
      const foundByIds = await this.permissionCatalog.findByIds(permissionIds);
      for (const p of foundByIds) {
        byId.set(Number(p.id), p);
      }
    }

    if (permissionCodes && permissionCodes.length > 0) {
      const ensuredByCodes = await this.permissionCatalog.ensurePermissionsByCodes(permissionCodes);
      for (const p of ensuredByCodes) {
        byId.set(Number(p.id), p);
      }
    }

    return [...byId.values()];
  }

  /** Tải bản đồ roleId -> số lượng người dùng đang giữ vai trò thông qua delegate hoặc UserRoleRepository */
  private async loadUserCountsMap(roleIds: readonly number[]): Promise<Map<number, number>> {
    if (roleIds.length === 0) {
      return new Map<number, number>();
    }
    if (this.roleUserCountDelegate) {
      return this.roleUserCountDelegate(roleIds);
    }
    if (this.userRoleRepository) {
      const links = await this.userRoleRepository.findByRoleIds(roleIds);
      const counts = new Map<number, number>();
      for (const link of links) {
        const rId = Number(link.roleId);
        counts.set(rId, (counts.get(rId) ?? 0) + 1);
      }
      return counts;
    }
    return new Map<number, number>();
  }

  /** Tải bản đồ roleId -> danh sách PermissionItemSummary từ bảng role_permissions join permissions */
  private async loadPermissionsMap(
    roleIds: readonly number[],
  ): Promise<Map<number, PermissionItemSummary[]>> {
    const map = new Map<number, PermissionItemSummary[]>();
    if (roleIds.length === 0) return map;

    const links = await this.rolePermissionRepository.findByRoleIds(roleIds);
    if (links.length === 0) return map;

    const permIds = [...new Set(links.map((l) => Number(l.permissionId)))];
    const perms = await this.permissionCatalog.findByIds(permIds);
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

  /** Khởi tạo danh sách quyền công bố động từ các tệp module.manifest.json thực tế trên đĩa (fallback khi dùng mock repo) */
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

  /** Lấy bản đồ các module đang hoạt động (fallback khi dùng mock repo) */
  private getActiveModulesMap(): Map<string, ModulePermissionsManifestInput> {
    if (this.customActiveModulesOverride) {
      return this.customActiveModulesOverride;
    }
    return this.registeredModules;
  }

  /** Tổng hợp bản đồ mã quyền -> thông tin quyền đã chuẩn hóa (fallback khi dùng mock repo) */
  private getActiveDeclaredPermissionsMap(): Map<string, NormalizedPermissionDeclaration> {
    return buildDeclaredPermissionsMap(this.getActiveModulesMap());
  }
}
