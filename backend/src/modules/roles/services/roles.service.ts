import { Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
} from '@packages/kernel/index.js';
import { TransactionManager } from '@packages/database/index.js';
import type { IRolesPublicService, RoleSummary } from '../contracts/index.js';
import { RoleRepository } from '../repositories/role.repository.js';
import { RolePermissionRepository } from '../repositories/role-permission.repository.js';
import { RolesMapper } from '../mappers/roles.mapper.js';
import type {
  CreateRoleRequest,
  ListRolesQuery,
  SetRolePermissionsRequest,
  UpdateRoleRequest,
} from '../requests/roles.requests.js';
import type { PermissionCatalogItemResponse, RoleResponse } from '../responses/roles.response.js';

@Injectable()
export class RolesService implements IRolesPublicService {
  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly rolePermissionRepository: RolePermissionRepository,
    private readonly mapper: RolesMapper,
    @Optional() private readonly transactionManager: TransactionManager | null = null,
  ) {}

  /** Lấy danh sách vai trò kèm danh sách quyền của từng vai trò */
  public async list(query: ListRolesQuery = {}): Promise<RoleResponse[]> {
    const roles = await this.roleRepository.findFiltered(query);
    if (roles.length === 0) return [];

    const permsMap = await this.loadPermissionsMap(roles.map((r) => r.id));
    return roles.map((role) => this.mapper.toResponse(role, permsMap.get(role.id) ?? []));
  }

  /** Lấy thông tin chi tiết một vai trò theo ID */
  public async getById(id: string): Promise<RoleResponse> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }
    const permsMap = await this.loadPermissionsMap([role.id]);
    return this.mapper.toResponse(role, permsMap.get(role.id) ?? []);
  }

  /** Lấy danh mục quyền hạn hệ thống từ bảng core_permissions */
  public async listPermissionsCatalog(): Promise<PermissionCatalogItemResponse[]> {
    try {
      const rows = (await this.roleRepository.manager.query(
        'SELECT code, module, description FROM core_permissions ORDER BY module ASC, code ASC',
      )) as Array<{ code: string; module: string; description: string }>;
      return rows.map((r) => ({
        code: String(r.code),
        module: String(r.module),
        description: String(r.description),
      }));
    } catch {
      return [];
    }
  }

  /** Tạo mới vai trò và gán quyền */
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
        status: dto.status ?? 'ACTIVE',
      });

      const permEntities = await this.rolePermissionRepository.replacePermissionsForRole(
        saved.id,
        dto.permissions ?? [],
      );
      return this.mapper.toResponse(
        saved,
        permEntities.map((p) => p.permissionCode),
      );
    };

    if (this.transactionManager) {
      return this.transactionManager.runInTransaction(work);
    }
    return work();
  }

  /** Cập nhật thông tin vai trò và danh sách quyền */
  public async update(id: string, dto: UpdateRoleRequest): Promise<RoleResponse> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }

    if (role.isSystem && dto.status === 'INACTIVE') {
      throw new ForbiddenAppException('roles.cannotDeactivateSystemRole', [{ code: role.code }]);
    }

    const work = async (): Promise<RoleResponse> => {
      if (dto.name !== undefined) role.name = dto.name.trim();
      if (dto.description !== undefined) role.description = dto.description;
      if (dto.status !== undefined) role.status = dto.status;

      const saved = await this.roleRepository.saveEntity(role);
      if (dto.permissions !== undefined) {
        const permEntities = await this.rolePermissionRepository.replacePermissionsForRole(
          saved.id,
          dto.permissions,
        );
        return this.mapper.toResponse(
          saved,
          permEntities.map((p) => p.permissionCode),
        );
      }

      const permsMap = await this.loadPermissionsMap([saved.id]);
      return this.mapper.toResponse(saved, permsMap.get(saved.id) ?? []);
    };

    if (this.transactionManager) {
      return this.transactionManager.runInTransaction(work);
    }
    return work();
  }

  /** Cập nhật riêng danh sách quyền hạn cho một vai trò */
  public async setPermissions(id: string, dto: SetRolePermissionsRequest): Promise<RoleResponse> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }

    const permEntities = await this.rolePermissionRepository.replacePermissionsForRole(
      role.id,
      dto.permissions,
    );
    return this.mapper.toResponse(
      role,
      permEntities.map((p) => p.permissionCode),
    );
  }

  /** Xóa mềm vai trò (chặn xóa đối với vai trò hệ thống isSystem = true) */
  public async remove(id: string): Promise<{ deleted: true; id: string }> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }
    if (role.isSystem) {
      throw new ForbiddenAppException('roles.cannotDeleteSystemRole', [{ code: role.code }]);
    }
    await this.roleRepository.repository.softDelete(id);
    return { deleted: true, id };
  }

  /** Hợp đồng công khai: Tìm danh sách vai trò theo mảng roleIds */
  public async findByIds(roleIds: readonly string[]): Promise<RoleSummary[]> {
    const roles = await this.roleRepository.findByIds(roleIds);
    if (roles.length === 0) return [];
    const permsMap = await this.loadPermissionsMap(roles.map((r) => r.id));
    return roles.map((role) => this.mapper.toSummary(role, permsMap.get(role.id) ?? []));
  }

  /** Hợp đồng công khai: Tìm danh sách vai trò theo mảng mã code */
  public async findByCodes(codes: readonly string[]): Promise<RoleSummary[]> {
    const roles = await this.roleRepository.findByCodes(codes);
    if (roles.length === 0) return [];
    const permsMap = await this.loadPermissionsMap(roles.map((r) => r.id));
    return roles.map((role) => this.mapper.toSummary(role, permsMap.get(role.id) ?? []));
  }

  /** Hợp đồng công khai: Tổng hợp danh sách mã quyền duy nhất từ mảng roleIds */
  public async resolvePermissionsByRoleIds(roleIds: readonly string[]): Promise<string[]> {
    const activeRoles = (await this.roleRepository.findByIds(roleIds)).filter(
      (r) => r.status === 'ACTIVE',
    );
    if (activeRoles.length === 0) return [];

    const permEntities = await this.rolePermissionRepository.findByRoleIds(
      activeRoles.map((r) => r.id),
    );
    return [...new Set(permEntities.map((p) => p.permissionCode))];
  }

  /** Hợp đồng công khai: Đảm bảo tất cả roleIds tồn tại và đang ACTIVE */
  public async ensureActiveRolesExist(roleIds: readonly string[]): Promise<RoleSummary[]> {
    const uniqueIds = [...new Set(roleIds)];
    if (uniqueIds.length === 0) return [];

    const roles = await this.roleRepository.findByIds(uniqueIds);
    const foundMap = new Map(roles.map((r) => [r.id, r]));

    const missingIds = uniqueIds.filter((id) => !foundMap.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestAppException('roles.invalidOrMissingRoles', [{ missingIds }]);
    }

    const inactiveIds = roles.filter((r) => r.status !== 'ACTIVE').map((r) => r.id);
    if (inactiveIds.length > 0) {
      throw new BadRequestAppException('roles.inactiveRolesNotAllowed', [{ inactiveIds }]);
    }

    const permsMap = await this.loadPermissionsMap(uniqueIds);
    return roles.map((role) => this.mapper.toSummary(role, permsMap.get(role.id) ?? []));
  }

  /** Nạp bảng ánh xạ roleId -> danh sách permissionCodes */
  private async loadPermissionsMap(roleIds: readonly string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (roleIds.length === 0) return map;

    const rows = await this.rolePermissionRepository.findByRoleIds(roleIds);
    for (const row of rows) {
      const list = map.get(row.roleId) ?? [];
      list.push(row.permissionCode);
      map.set(row.roleId, list);
    }
    return map;
  }
}
