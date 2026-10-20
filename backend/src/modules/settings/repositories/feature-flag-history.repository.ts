import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { FeatureFlagHistoryEntity } from '../entities/feature-flag-history.entity.js';

@Injectable()
export class FeatureFlagHistoryRepository extends BaseTypeOrmRepository<FeatureFlagHistoryEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(FeatureFlagHistoryEntity, dataSource, transactionManager);
  }

  public async searchFiltered(params?: {
    flagId?: number | undefined;
    flagKey?: string | undefined;
    action?: string | undefined;
    actorUserId?: number | undefined;
    limit?: number | undefined;
  }): Promise<FeatureFlagHistoryEntity[]> {
    const limit = Math.max(1, Math.min(200, params?.limit ?? 50));
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('ffh').orderBy('ffh.id', 'DESC').take(limit);

      if (params?.flagId !== undefined) {
        qb.andWhere('ffh.flagId = :flagId', {
          flagId: Number(params.flagId),
        });
      }
      if (params?.flagKey?.trim()) {
        qb.andWhere('LOWER(ffh.flagKey) = :flagKey', {
          flagKey: params.flagKey.trim().toLowerCase(),
        });
      }
      if (params?.action?.trim()) {
        qb.andWhere('UPPER(ffh.action) = :action', {
          action: params.action.trim().toUpperCase(),
        });
      }
      if (params?.actorUserId !== undefined) {
        qb.andWhere('ffh.actorUserId = :actorUserId', {
          actorUserId: Number(params.actorUserId),
        });
      }

      return qb.getMany();
    });
  }
}
