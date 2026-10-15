import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { RolePermissionEntity } from '../entities/role-permission.entity.js';

@Injectable()
export class RolePermissionRepository extends BaseTypeOrmRepository<RolePermissionEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(RolePermissionEntity, dataSource, transactionManager);
  }

  /** Lấy toàn bộ bản ghi quyền gắn với danh sách roleIds */
  public async findByRoleIds(roleIds: readonly string[]): Promise<RolePermissionEntity[]> {
    if (roleIds.length === 0) return [];
    const uniqueIds = [...new Set(roleIds)];
    return this.repository.find({
      where: { roleId: In(uniqueIds) },
    });
  }

  /** Thay thế danh sách quyền của một vai trò */
  public async replacePermissionsForRole(
    roleId: string,
    permissionCodes: readonly string[],
  ): Promise<RolePermissionEntity[]> {
    await this.repository.delete({ roleId });
    const uniqueCodes = [...new Set(permissionCodes.map((p) => p.trim()).filter(Boolean))];
    if (uniqueCodes.length === 0) {
      return [];
    }

    const entities = uniqueCodes.map((code) =>
      this.repository.create({
        roleId,
        permissionCode: code,
      }),
    );

    return this.repository.save(entities);
  }
}
