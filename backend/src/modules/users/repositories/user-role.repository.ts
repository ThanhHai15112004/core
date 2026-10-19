import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { UserRoleEntity } from '../entities/user-role.entity.js';

@Injectable()
export class UserRoleRepository extends BaseTypeOrmRepository<UserRoleEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(UserRoleEntity, dataSource, transactionManager);
  }

  /** Tìm danh sách vai trò đã gán cho mảng userIds */
  public async findByUserIds(userIds: readonly number[]): Promise<UserRoleEntity[]> {
    if (userIds.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { userId: In([...userIds]) },
        order: { id: 'ASC' },
      }),
    );
  }

  /** Tìm danh sách bản ghi gán vai trò thuộc một hoặc nhiều roleIds */
  public async findByRoleIds(roleIds: readonly number[]): Promise<UserRoleEntity[]> {
    if (roleIds.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { roleId: In([...roleIds]) },
        order: { id: 'ASC' },
      }),
    );
  }

  /** Tìm danh sách userIds thuộc một hoặc nhiều roleIds */
  public async findUserIdsByRoleIds(roleIds: readonly number[]): Promise<number[]> {
    if (roleIds.length === 0) return [];
    const rows = await this.executeReadOnly(async (repo) =>
      repo.find({
        where: { roleId: In([...roleIds]) },
        select: { userId: true },
      }),
    );
    return [...new Set(rows.map((r) => Number(r.userId)))];
  }

  /** Thay thế toàn bộ danh sách vai trò của một người dùng */
  public async replaceUserRoles(
    userId: number,
    roleIds: readonly number[],
    assignedBy?: number | null,
  ): Promise<UserRoleEntity[]> {
    const uniqueRoleIds = [...new Set(roleIds.map(Number).filter((n) => n >= 1))];

    await this.repository.delete({ userId });

    if (uniqueRoleIds.length === 0) {
      return [];
    }

    const entities = uniqueRoleIds.map((roleId) =>
      this.repository.create({
        userId,
        roleId,
        assignedBy: assignedBy ?? null,
      }),
    );
    return this.repository.save(entities);
  }
}
