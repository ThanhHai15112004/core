import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { UserProfileEntity } from '../entities/user-profile.entity.js';

@Injectable()
export class UserProfileRepository extends BaseTypeOrmRepository<UserProfileEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(UserProfileEntity, dataSource, transactionManager);
  }

  /** Tìm hồ sơ chi tiết của một người dùng theo userId */
  public async findByUserId(userId: number): Promise<UserProfileEntity | null> {
    return this.repository.findOne({
      where: { userId: Number(userId) },
    });
  }

  /** Tìm danh sách hồ sơ chi tiết cho nhiều userIds cùng lúc (tránh N+1 query) */
  public async findByUserIds(userIds: readonly number[]): Promise<UserProfileEntity[]> {
    if (userIds.length === 0) return [];
    const normalizedIds = [...new Set(userIds.map(Number))];
    return this.repository.find({
      where: { userId: In(normalizedIds) },
    });
  }

  /** Tạo mới hoặc cập nhật thông tin chi tiết hồ sơ người dùng theo userId */
  public async upsertByUserId(
    userId: number,
    data: Partial<UserProfileEntity>,
  ): Promise<UserProfileEntity> {
    const existing = await this.findByUserId(userId);
    if (existing) {
      Object.assign(existing, data, { userId: Number(userId) });
      return this.saveEntity(existing);
    }
    return this.saveEntity({
      ...data,
      userId: Number(userId),
    });
  }
}
