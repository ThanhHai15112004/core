import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { toLikePattern } from '@packages/http/index.js';
import { SequenceRuleEntity } from '../entities/sequence-rule.entity.js';

@Injectable()
export class SequenceRuleRepository extends BaseTypeOrmRepository<SequenceRuleEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(SequenceRuleEntity, dataSource, transactionManager);
  }

  public async findByKey(sequenceKey: string): Promise<SequenceRuleEntity | null> {
    const normalized = sequenceKey.trim().toLowerCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { sequenceKey: normalized },
      }),
    );
  }

  public async findFiltered(params?: {
    module?: string | undefined;
    resetPolicy?: number | undefined;
    scopeByUnit?: boolean | undefined;
    status?: number | undefined;
    q?: string | undefined;
  }): Promise<SequenceRuleEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('sr')
        .orderBy('sr.module', 'ASC')
        .addOrderBy('sr.sequenceKey', 'ASC');

      if (params?.module?.trim()) {
        qb.andWhere('LOWER(sr.module) = :module', {
          module: params.module.trim().toLowerCase(),
        });
      }
      if (params?.resetPolicy !== undefined) {
        qb.andWhere('sr.resetPolicy = :resetPolicy', { resetPolicy: params.resetPolicy });
      }
      if (params?.scopeByUnit !== undefined) {
        qb.andWhere('sr.scopeByUnit = :scopeByUnit', { scopeByUnit: params.scopeByUnit });
      }
      if (params?.status !== undefined) {
        qb.andWhere('sr.status = :status', { status: params.status });
      }
      if (params?.q?.trim()) {
        const keyword = toLikePattern(params.q.trim().toLowerCase(), 'contains');
        qb.andWhere(
          '(LOWER(sr.sequenceKey) LIKE :keyword OR LOWER(sr.name) LIKE :keyword OR LOWER(sr.prefix) LIKE :keyword)',
          { keyword },
        );
      }

      return qb.getMany();
    });
  }
}
