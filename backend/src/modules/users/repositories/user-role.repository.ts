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

  /** Lấy danh sách liên kết vai trò theo mảng userIds */
  public async findByUserIds(userIds: readonly string[]): Promise<UserRoleEntity[]> {
    if (userIds.length === 0) return [];
    const uniqueIds = [...new Set(userIds)];
    return this.repository.find({
      where: { userId: In(uniqueIds) },
    });
  }

  /** Thay thế danh sách vai trò của một người dùng */
  public async replaceUserRoles(
    userId: string,
    roleIds: readonly string[],
    assignedBy?: string | null,
  ): Promise<UserRoleEntity[]> {
    await this.repository.delete({ userId });
    const uniqueRoleIds = [...new Set(roleIds)];
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
