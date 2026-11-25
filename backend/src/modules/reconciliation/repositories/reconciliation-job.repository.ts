import { Injectable, Optional } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ReconciliationJobEntity } from '../entities/reconciliation-job.entity.js';
import type { ListReconciliationJobsQuery } from '../requests/reconciliation.requests.js';

@Injectable()
export class ReconciliationJobRepository extends BaseTypeOrmRepository<ReconciliationJobEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ReconciliationJobEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<ReconciliationJobEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByJobCode(jobCode: string): Promise<ReconciliationJobEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { jobCode } });
  }

  public async listPaginated(
    filter: ListReconciliationJobsQuery,
  ): Promise<PaginatedResult<ReconciliationJobEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('job');

    if (filter.adapterCode?.trim()) {
      qb.andWhere('job.adapterCode = :adapterCode', {
        adapterCode: filter.adapterCode.trim().toLowerCase(),
      });
    }
    if (filter.targetModule?.trim()) {
      qb.andWhere('job.targetModule = :targetModule', {
        targetModule: filter.targetModule.trim().toLowerCase(),
      });
    }
    if (filter.isEnabled !== undefined) {
      qb.andWhere('job.isEnabled = :isEnabled', { isEnabled: filter.isEnabled });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'job.jobCode',
        'job.name',
        'job.description',
        'job.adapterCode',
        'job.targetModule',
      ]);
    }

    qb.orderBy('job.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }

  public async listDueScheduledJobs(now: Date): Promise<ReconciliationJobEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository
      .createQueryBuilder('job')
      .where('job.isEnabled = :enabled', { enabled: true })
      .andWhere('job.scheduleCron IS NOT NULL')
      .andWhere("job.scheduleCron <> ''")
      .andWhere('(job.nextRunAt IS NULL OR job.nextRunAt <= :now)', { now })
      .orderBy('job.id', 'ASC')
      .getMany();
  }
}
