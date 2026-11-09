import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { RecordUserOrganizationHistoryInput } from '../contracts/index.js';
import { UserOrganizationHistoryEntity } from '../entities/user-organization-history.entity.js';

export type { RecordUserOrganizationHistoryInput };

@Injectable()
export class UserOrganizationHistoryRepository extends BaseTypeOrmRepository<UserOrganizationHistoryEntity> {
  constructor(dataSource: DataSource, @Optional() transactionManager?: TransactionManager) {
    super(UserOrganizationHistoryEntity, dataSource, transactionManager);
  }

  public async recordHistories(
    inputs: readonly RecordUserOrganizationHistoryInput[],
  ): Promise<UserOrganizationHistoryEntity[]> {
    if (inputs.length === 0) return [];
    const results: UserOrganizationHistoryEntity[] = [];
    for (const input of inputs) {
      const saved = await this.saveEntity({
        userId: input.userId,
        organizationUnitId: input.organizationUnitId,
        fromOrganizationUnitId: input.fromOrganizationUnitId,
        actionType: input.actionType,
        isPrimary: input.isPrimary,
        positionTitle: input.positionTitle,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason,
        changedBy: input.changedBy,
      });
      results.push(saved);
    }
    return results;
  }

  public async findByUserId(userId: number): Promise<UserOrganizationHistoryEntity[]> {
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { userId },
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
    );
  }
}
