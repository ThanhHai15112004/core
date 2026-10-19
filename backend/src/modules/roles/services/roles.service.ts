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
  UpdateRoleRequest,
} from '../requests/roles.requests.js';
import type {
  PermissionCatalogItemResponse,
  RoleAssignedUserResponse,
  RoleResponse,
} from '../responses/roles.response.js';

@Injectable()
export class RolesService implements IRolesPublicService {
  private roleUserCountDelegate?: (roleIds: readonly number[]) => Promise<Map<number, number>>;
  private roleUsersListDelegate?: (roleId: number) => Promise<RoleAssignedUserSummary[]>;

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly rolePermissionRepository: RolePermissionRepository,
    private readonly mapper: RolesMapper,
    @Optional()
    @Inject(PermissionRepository)
    private readonly permissionRepository: PermissionRepository | null = null,
    @Optional()
    @Inject(TransactionManager)
    private readonly transactionManager: TransactionManager | null = null,
  ) {}

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

  /** Lấy danh mục quyền hạn hệ thống từ bảng permissions */
  public async listPermissionsCatalog(): Promise<PermissionCatalogItemResponse[]> {
    if (!this.permissionRepository) return [];
    const perms = await this.permissionRepository.findAll();
    return perms.map((p) => ({
      id: Number(p.id),
      code: p.code,
      name: p.name,
      module: p.module,
      description: p.description ?? null,
      status:
        p.status === PERMISSION_STATUS.INACTIVE
          ? PERMISSION_STATUS.INACTIVE
          : PERMISSION_STATUS.ACTIVE,
      statusName: p.status === PERMISSION_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
    }));
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
    if (!this.permissionRepository) {
      return [];
    }

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
    if (roleIds.length === 0 || !this.permissionRepository) return map;

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
}
