import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { UserOrganizationHistoryActionType } from '../contracts/index.js';
import { UserOrganizationHistoryEntity } from '../entities/user-organization-history.entity.js';

export interface RecordUserOrganizationHistoryInput {
  readonly userId: number;
  readonly organizationUnitId: number;
  readonly fromOrganizationUnitId?: number | null | undefined;
  readonly actionType: UserOrganizationHistoryActionType;
  readonly isPrimary: boolean;
  readonly positionTitle?: string | null | undefined;
  readonly startDate?: Date | null | undefined;
  readonly endDate?: Date | null | undefined;
  readonly reason?: string | null | undefined;
  readonly changedBy?: number | null | undefined;
}

@Injectable()
export class UserOrganizationHistoryRepository extends BaseTypeOrmRepository<UserOrganizationHistoryEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(UserOrganizationHistoryEntity, dataSource, transactionManager);
  }

  /** Ghi nhận một hoặc nhiều bản ghi lịch sử biến động đơn vị công tác (membership history) */
  public async recordHistories(
    inputs: readonly RecordUserOrganizationHistoryInput[],
  ): Promise<UserOrganizationHistoryEntity[]> {
    if (inputs.length === 0) return [];
    const results: UserOrganizationHistoryEntity[] = [];
    for (const item of inputs) {
      const saved = await this.saveEntity({
        userId: Number(item.userId),
        organizationUnitId: Number(item.organizationUnitId),
        fromOrganizationUnitId:
          item.fromOrganizationUnitId !== undefined && item.fromOrganizationUnitId !== null
            ? Number(item.fromOrganizationUnitId)
            : null,
        actionType: item.actionType,
        isPrimary: Boolean(item.isPrimary),
        positionTitle: item.positionTitle ?? null,
        startDate: item.startDate ?? null,
        endDate: item.endDate ?? null,
        reason: item.reason ?? null,
        changedBy:
          item.changedBy !== undefined && item.changedBy !== null ? Number(item.changedBy) : null,
      });
      results.push(saved);
    }
    return results;
  }

  /** Lấy danh sách lịch sử đơn vị công tác của một người dùng (mới nhất trước) */
  public async findByUserId(userId: number): Promise<UserOrganizationHistoryEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { userId: Number(userId) },
        order: { id: 'DESC' },
      }),
    );
  }
}
