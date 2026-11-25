import { Injectable, Optional } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ReconciliationRunEntity } from '../entities/reconciliation-run.entity.js';
import type { ListReconciliationRunsQuery } from '../requests/reconciliation.requests.js';

@Injectable()
export class ReconciliationRunRepository extends BaseTypeOrmRepository<ReconciliationRunEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ReconciliationRunEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<ReconciliationRunEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByRunCode(runCode: string): Promise<ReconciliationRunEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { runCode } });
  }

  public async listPaginated(
    filter: ListReconciliationRunsQuery,
  ): Promise<PaginatedResult<ReconciliationRunEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('run');

    if (filter.jobId !== undefined) {
      qb.andWhere('run.jobId = :jobId', { jobId: filter.jobId });
    }
    if (filter.adapterCode?.trim()) {
      qb.andWhere('run.adapterCode = :adapterCode', {
        adapterCode: filter.adapterCode.trim().toLowerCase(),
      });
    }
    if (filter.triggerMode) {
      qb.andWhere('run.triggerMode = :triggerMode', { triggerMode: filter.triggerMode });
    }
    if (filter.status !== undefined) {
      qb.andWhere('run.status = :status', { status: filter.status });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'run.runCode',
        'run.jobCode',
        'run.adapterCode',
        'run.targetModule',
        'run.correlationId',
      ]);
    }

    qb.orderBy('run.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
