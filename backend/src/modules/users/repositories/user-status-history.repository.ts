import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { UserStatusCode } from '../contracts/index.js';
import { UserStatusHistoryEntity } from '../entities/user-status-history.entity.js';

@Injectable()
export class UserStatusHistoryRepository extends BaseTypeOrmRepository<UserStatusHistoryEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(UserStatusHistoryEntity, dataSource, transactionManager);
  }

  /** Ghi một bản ghi lịch sử chuyển đổi trạng thái của người dùng */
  public async recordTransition(input: {
    userId: number;
    fromStatus: UserStatusCode | null;
    toStatus: UserStatusCode;
    reason?: string | null | undefined;
    changedBy?: number | null | undefined;
  }): Promise<UserStatusHistoryEntity> {
    return this.saveEntity({
      userId: input.userId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      reason: input.reason ?? null,
      changedBy: input.changedBy ?? null,
    });
  }

  /** Lấy danh sách lịch sử thay đổi trạng thái của một người dùng (mới nhất trước) */
  public async findByUserId(userId: number): Promise<UserStatusHistoryEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { userId },
        order: { id: 'DESC' },
      }),
    );
  }
}
