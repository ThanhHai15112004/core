import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { resolvePagination } from '@packages/kernel/index.js';
import { SequenceRuleHistoryEntity } from '../entities/sequence-rule-history.entity.js';

@Injectable()
export class SequenceRuleHistoryRepository extends BaseTypeOrmRepository<SequenceRuleHistoryEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(SequenceRuleHistoryEntity, dataSource, transactionManager);
  }

  public async findFiltered(params?: {
    sequenceKey?: string | undefined;
    action?: string | undefined;
    actorUserId?: number | undefined;
    limit?: number | undefined;
  }): Promise<SequenceRuleHistoryEntity[]> {
    const { limit } = resolvePagination(params, { defaultLimit: 50, maxLimit: 200 });
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('srh')
        .orderBy('srh.createdAt', 'DESC')
        .addOrderBy('srh.id', 'DESC')
        .take(limit);

      if (params?.sequenceKey?.trim()) {
        qb.andWhere('LOWER(srh.sequenceKey) = :sequenceKey', {
          sequenceKey: params.sequenceKey.trim().toLowerCase(),
        });
      }
      if (params?.action?.trim()) {
        qb.andWhere('UPPER(srh.action) = :action', {
          action: params.action.trim().toUpperCase(),
        });
      }
      if (params?.actorUserId !== undefined) {
        qb.andWhere('srh.actorUserId = :actorUserId', { actorUserId: params.actorUserId });
      }

      return qb.getMany();
    });
  }
}
