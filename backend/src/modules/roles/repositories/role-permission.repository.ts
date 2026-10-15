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

  /** Lấy danh sách liên kết quyền hạn theo mảng roleIds */
  public async findByRoleIds(roleIds: readonly number[]): Promise<RolePermissionEntity[]> {
    if (roleIds.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { roleId: In([...roleIds]) },
        order: { id: 'ASC' },
      }),
    );
  }

  /** Thay thế toàn bộ danh sách permissionIds cho một vai trò */
  public async replacePermissionsForRole(
    roleId: number,
    permissionIds: readonly number[],
  ): Promise<RolePermissionEntity[]> {
    const uniquePermIds = [...new Set(permissionIds.map(Number).filter((n) => n >= 1))];

    await this.repository.delete({ roleId });

    if (uniquePermIds.length === 0) {
      return [];
    }

    const entities = uniquePermIds.map((permissionId) =>
      this.repository.create({
        roleId,
        permissionId,
      }),
    );
    return this.repository.save(entities);
  }
}
