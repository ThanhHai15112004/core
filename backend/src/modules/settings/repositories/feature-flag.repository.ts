import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { FeatureFlagEntity } from '../entities/feature-flag.entity.js';

@Injectable()
export class FeatureFlagRepository extends BaseTypeOrmRepository<FeatureFlagEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(FeatureFlagEntity, dataSource, transactionManager);
  }

  public async findByKey(flagKey: string): Promise<FeatureFlagEntity | null> {
    const normalized = flagKey.trim().toLowerCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { flagKey: normalized },
      }),
    );
  }

  public async findFiltered(params?: {
    module?: string | undefined;
    isEnabled?: boolean | undefined;
    status?: number | undefined;
    q?: string | undefined;
  }): Promise<FeatureFlagEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('ff')
        .orderBy('ff.module', 'ASC')
        .addOrderBy('ff.flagKey', 'ASC');

      if (params?.module?.trim()) {
        qb.andWhere('LOWER(ff.module) = :module', {
          module: params.module.trim().toLowerCase(),
        });
      }
      if (params?.isEnabled !== undefined) {
        qb.andWhere('ff.isEnabled = :isEnabled', { isEnabled: params.isEnabled });
      }
      if (params?.status !== undefined) {
        qb.andWhere('ff.status = :status', { status: params.status });
      }
      if (params?.q?.trim()) {
        const keyword = `%${params.q.trim().toLowerCase()}%`;
        qb.andWhere(
          '(LOWER(ff.flagKey) LIKE :keyword OR LOWER(ff.name) LIKE :keyword OR LOWER(ff.description) LIKE :keyword)',
          { keyword },
        );
      }

      return qb.getMany();
    });
  }
}
