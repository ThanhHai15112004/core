import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
} from '@packages/kernel/index.js';
import { TransactionManager } from '@packages/database/index.js';
import {
  type IRolesPublicService,
  type ModulePermissionDeclaration,
  type ModulePermissionsManifestInput,
  PERMISSION_STATUS,
  ROLE_STATUS,
  type RoleAssignedUserSummary,
  type RoleSummary,
} from '../contracts/index.js';
import type { PermissionEntity } from '../entities/permission.entity.js';
import { PermissionRepository } from '../repositories/permission.repository.js';
import { RoleRepository } from '../repositories/role.repository.js';
import { RolePermissionRepository } from '../repositories/role-permission.repository.js';
import { RolesMapper } from '../mappers/roles.mapper.js';
import type {
  CloneRoleRequest,
  CreateRoleRequest,
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
  RolePermissionMatrixRowResponse,
  RoleResponse,
  SyncPermissionsResultResponse,
} from '../responses/roles.response.js';

interface NormalizedPermissionDeclaration {
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly moduleDisplayName: string;
  readonly featureGroup: string;
  readonly description: string | null;
}

@Injectable()
export class RolesService implements IRolesPublicService {
  private roleUserCountDelegate?: (roleIds: readonly number[]) => Promise<Map<number, number>>;
  private roleUsersListDelegate?: (roleId: number) => Promise<RoleAssignedUserSummary[]>;
  private readonly registeredModules = new Map<string, ModulePermissionsManifestInput>();
  private customActiveModulesOverride: Map<string, ModulePermissionsManifestInput> | null = null;

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly rolePermissionRepository: RolePermissionRepository,
    private readonly mapper: RolesMapper,
    private readonly permissionRepository: PermissionRepository,
    @Optional()
    @Inject(TransactionManager)
    private readonly transactionManager: TransactionManager | null = null,
  ) {
    this.initializeModuleManifests();
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
    return roles.map((role) =>
      this.mapper.toResponse(
        role,
        permsMap.get(Number(role.id)) ?? [],
        countsMap.get(Number(role.id)) ?? 0,
      ),
    );
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

    return perms.map((p) => {
      const normalizedCode = p.code.trim().toLowerCase();
      const declared = declaredMap.get(normalizedCode);
      const moduleName = p.module || declared?.module || this.extractModuleFromCode(normalizedCode);
      const featureGroup =
        declared?.featureGroup ?? this.deriveFeatureGroup(normalizedCode, moduleName);

      return {
        id: Number(p.id),
        code: p.code,
        name: p.name,
        module: moduleName,
        featureGroup,
        description: p.description ?? null,
        status:
          p.status === PERMISSION_STATUS.INACTIVE
            ? PERMISSION_STATUS.INACTIVE
            : PERMISSION_STATUS.ACTIVE,
        statusName: p.status === PERMISSION_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
        isOrphaned: !declaredMap.has(normalizedCode),
      };
    });
  }

  /** Nhóm danh mục quyền theo module và nhóm chức năng (Mục 4.2 — Nhóm quyền theo chức năng dễ chọn và quản lý) */
  public async listPermissionsGrouped(): Promise<PermissionFunctionalGroupResponse[]> {
    const catalog = await this.listPermissionsCatalog();
    const activeModules = this.getActiveModulesMap();
    const groupsMap = new Map<
      string,
      {
        module: string;
        moduleDisplayName: string;
        featureGroup: string;
        permissions: PermissionCatalogItemResponse[];
      }
    >();

    for (const item of catalog) {
      const key = `${item.module}::${item.featureGroup}`;
      const existing = groupsMap.get(key);
      if (existing) {
        existing.permissions.push(item);
      } else {
        const modManifest = activeModules.get(item.module.toLowerCase());
        groupsMap.set(key, {
          module: item.module,
          moduleDisplayName: modManifest?.displayName || item.module,
          featureGroup: item.featureGroup,
          permissions: [item],
        });
      }
    }

    return [...groupsMap.values()]
      .sort((a, b) =>
        a.module === b.module
          ? a.featureGroup.localeCompare(b.featureGroup)
          : a.module.localeCompare(b.module),
      )
      .map((g) => ({
        module: g.module,
        moduleDisplayName: g.moduleDisplayName,
        featureGroup: g.featureGroup,
        totalPermissions: g.permissions.length,
        permissions: g.permissions,
      }));
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

    return orphanedPerms.map((perm) => {
      const assignedRoles = roles
        .filter((role) => {
          const rolePerms = permsMap.get(Number(role.id)) ?? [];
          return rolePerms.some((rp) => Number(rp.id) === Number(perm.id) || rp.code === perm.code);
        })
        .map((role) => ({
          id: Number(role.id),
          code: role.code,
          name: role.name,
        }));

      return {
        id: Number(perm.id),
        code: perm.code,
        name: perm.name,
        module: perm.module,
        assignedRoles,
        warningMessage:
          assignedRoles.length > 0
            ? `Permission '${perm.code}' is not declared by any active module manifest and is still assigned to ${assignedRoles.length} role(s).`
            : `Permission '${perm.code}' is not declared by any active module manifest (unused orphan permission).`,
      };
    });
  }

  /** Tạo bảng ma trận tổng hợp Vai trò × Quyền toàn hệ thống (Mục 4.2 — Dễ rà soát quyền toàn hệ thống) */
  public async getPermissionMatrix(): Promise<RolePermissionMatrixResponse> {
    const [roles, catalog] = await Promise.all([
      this.roleRepository.findFiltered({}),
      this.listPermissionsCatalog(),
    ]);

    const roleIds = roles.map((r) => Number(r.id));
    const permsMap = await this.loadPermissionsMap(roleIds);

    const rolePermCodeSets = new Map<number, Set<string>>();
    for (const role of roles) {
      const rId = Number(role.id);
      const rPerms = permsMap.get(rId) ?? [];
      rolePermCodeSets.set(rId, new Set(rPerms.map((p) => p.code.trim().toLowerCase())));
    }

    const rows: RolePermissionMatrixRowResponse[] = catalog.map((perm) => {
      const normalizedCode = perm.code.trim().toLowerCase();
      const grantedRoleIds: number[] = [];
      const grantedRoleCodes: string[] = [];
      const roleGrants: Record<string, boolean> = {};

      for (const role of roles) {
        const rId = Number(role.id);
        const hasPerm = rolePermCodeSets.get(rId)?.has(normalizedCode) ?? false;
        roleGrants[role.code] = hasPerm;
        if (hasPerm) {
          grantedRoleIds.push(rId);
          grantedRoleCodes.push(role.code);
        }
      }

      return {
        permissionId: perm.id,
        code: perm.code,
        name: perm.name,
        module: perm.module,
        featureGroup: perm.featureGroup,
        isOrphaned: perm.isOrphaned,
        grantedRoleIds,
        grantedRoleCodes,
        roleGrants,
      };
    });

    const modulesSet = new Set<string>(catalog.map((c) => c.module));
    const totalOrphanedPermissions = catalog.filter((c) => c.isOrphaned).length;

    return {
      roles: roles.map((role) => {
        const rId = Number(role.id);
        const mapped = this.mapper.toSummary(role, permsMap.get(rId) ?? []);
        return {
          id: mapped.id,
          code: mapped.code,
          name: mapped.name,
          isSystem: mapped.isSystem,
          status: mapped.status,
          statusName: mapped.statusName,
          totalGrantedPermissions: mapped.permissions.length,
        };
      }),
      modules: [...modulesSet].sort(),
      rows,
      summary: {
        totalRoles: roles.length,
        totalPermissions: catalog.length,
        totalOrphanedPermissions,
      },
    };
  }

  /** Tạo mới vai trò và gán quyền (hỗ trợ cả permissionIds hoặc permissions codes) */
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

    const work = async (): Promise<RoleResponse> => {
      const saved = await this.roleRepository.saveEntity({
        code: normalizedCode,
        name: dto.name.trim(),
        description: dto.description ?? null,
        isSystem: false,
        status: dto.status ?? ROLE_STATUS.ACTIVE,
      });

      const resolvedPerms = await this.resolveInputPermissions(dto.permissionIds, dto.permissions);
      await this.rolePermissionRepository.replacePermissionsForRole(
        Number(saved.id),
        resolvedPerms.map((p) => Number(p.id)),
      );
      return this.mapper.toResponse(saved, resolvedPerms, 0);
    };

    if (this.transactionManager) {
      return this.transactionManager.runInTransaction(work);
    }
    return work();
  }

  /** Sao chép vai trò: Tạo vai trò mới kế thừa toàn bộ quyền từ một vai trò hiện có (Mục 4.1) */
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

    const work = async (): Promise<RoleResponse> => {
      const saved = await this.roleRepository.saveEntity({
        code: normalizedCode,
        name: dto.name.trim(),
        description: resolvedDescription,
        isSystem: false,
        status: dto.status ?? ROLE_STATUS.ACTIVE,
      });

      await this.rolePermissionRepository.replacePermissionsForRole(
        Number(saved.id),
        sourcePerms.map((p) => Number(p.id)),
      );
      return this.mapper.toResponse(saved, sourcePerms, 0);
    };

    if (this.transactionManager) {
      return this.transactionManager.runInTransaction(work);
    }
    return work();
  }

  /** Cập nhật thông tin vai trò (tên, mô tả, trạng thái — giữ nguyên mã code) và danh sách quyền */
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

    const work = async (): Promise<RoleResponse> => {
      if (dto.name !== undefined) role.name = dto.name.trim();
      if (dto.description !== undefined) role.description = dto.description;
      if (dto.status !== undefined) role.status = dto.status;

      const saved = await this.roleRepository.saveEntity(role);
      if (dto.permissionIds !== undefined || dto.permissions !== undefined) {
        const resolvedPerms = await this.resolveInputPermissions(
          dto.permissionIds,
          dto.permissions,
        );
        await this.rolePermissionRepository.replacePermissionsForRole(
          Number(saved.id),
          resolvedPerms.map((p) => Number(p.id)),
        );
        return this.mapper.toResponse(saved, resolvedPerms, userCount);
      }

      const permsMap = await this.loadPermissionsMap([Number(saved.id)]);
      return this.mapper.toResponse(saved, permsMap.get(Number(saved.id)) ?? [], userCount);
    };

    if (this.transactionManager) {
      return this.transactionManager.runInTransaction(work);
    }
    return work();
  }

  /** Cập nhật riêng danh sách quyền hạn cho một vai trò */
  public async setPermissions(id: number, dto: SetRolePermissionsRequest): Promise<RoleResponse> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }

    const [resolvedPerms, countsMap] = await Promise.all([
      this.resolveInputPermissions(dto.permissionIds, dto.permissions),
      this.loadUserCountsMap([Number(role.id)]),
    ]);
    await this.rolePermissionRepository.replacePermissionsForRole(
      Number(role.id),
      resolvedPerms.map((p) => Number(p.id)),
    );
    return this.mapper.toResponse(role, resolvedPerms, countsMap.get(Number(role.id)) ?? 0);
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
    const candidateDirs = [
      resolve(process.cwd(), 'src/modules'),
      resolve(process.cwd(), 'src/project-modules'),
      resolve(process.cwd(), 'backend/src/modules'),
      resolve(process.cwd(), 'backend/src/project-modules'),
    ];

    for (const baseDir of candidateDirs) {
      if (!existsSync(baseDir)) continue;
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = join(baseDir, entry.name, 'module.manifest.json');
        if (!existsSync(manifestPath)) continue;
        const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          name?: string;
          displayName?: string;
          permissions?: (string | ModulePermissionDeclaration)[];
        };
        const modName = (raw.name || entry.name).trim().toLowerCase();
        if (modName && Array.isArray(raw.permissions)) {
          const existing = this.registeredModules.get(modName);
          const mergedPerms = existing
            ? [...existing.permissions, ...raw.permissions]
            : raw.permissions;
          this.registerModulePermissions({
            module: modName,
            displayName: raw.displayName || existing?.displayName || modName,
            permissions: mergedPerms,
          });
        }
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
    const activeModules = this.getActiveModulesMap();
    const map = new Map<string, NormalizedPermissionDeclaration>();

    for (const [modKey, manifest] of activeModules.entries()) {
      const moduleName = modKey.trim().toLowerCase();
      const moduleDisplayName = manifest.displayName?.trim() || moduleName;

      for (const permEntry of manifest.permissions) {
        if (typeof permEntry === 'string') {
          const code = permEntry.trim().toLowerCase();
          if (!code) continue;
          map.set(code, {
            code,
            name: this.formatPermissionDisplayName(code),
            module: moduleName,
            moduleDisplayName,
            featureGroup: this.deriveFeatureGroup(code, moduleName),
            description: `Permission ${code} declared by module ${moduleName}`,
          });
        } else if (permEntry && typeof permEntry === 'object') {
          const code = permEntry.code.trim().toLowerCase();
          if (!code) continue;
          map.set(code, {
            code,
            name: permEntry.name?.trim() || this.formatPermissionDisplayName(code),
            module: moduleName,
            moduleDisplayName,
            featureGroup:
              permEntry.featureGroup?.trim() || this.deriveFeatureGroup(code, moduleName),
            description:
              permEntry.description !== undefined
                ? permEntry.description
                : `Permission ${code} declared by module ${moduleName}`,
          });
        }
      }
    }

    return map;
  }

  /** Trích xuất tên module từ mã quyền (ví dụ `users.read` -> `users`) */
  private extractModuleFromCode(code: string): string {
    const normalized = code.trim().toLowerCase();
    return normalized.includes('.') ? normalized.split('.')[0]! : 'core';
  }

  /** Suy diễn nhóm chức năng từ mã quyền (ví dụ `auth.sessions.manage` -> `auth.sessions`, `users.read` -> `users`) */
  private deriveFeatureGroup(code: string, moduleName: string): string {
    const parts = code.trim().toLowerCase().split('.').filter(Boolean);
    if (parts.length >= 3) {
      return `${parts[0]}.${parts[1]}`;
    }
    return moduleName || parts[0] || 'core';
  }

  /** Tạo tên hiển thị thân thiện từ mã quyền */
  private formatPermissionDisplayName(code: string): string {
    return code
      .trim()
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
