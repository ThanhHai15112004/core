import { Injectable, Optional } from '@nestjs/common';
import type { DataSource, SelectQueryBuilder } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ReconciliationDiscrepancyEntity } from '../entities/reconciliation-discrepancy.entity.js';
import type {
  DiscrepancyReportQuery,
  ListDiscrepanciesQuery,
} from '../requests/reconciliation.requests.js';

@Injectable()
export class ReconciliationDiscrepancyRepository extends BaseTypeOrmRepository<ReconciliationDiscrepancyEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ReconciliationDiscrepancyEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<ReconciliationDiscrepancyEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async listPaginated(
    filter: ListDiscrepanciesQuery,
  ): Promise<PaginatedResult<ReconciliationDiscrepancyEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('disc');
    this.applyFilter(qb, filter);
    qb.orderBy('disc.severity', 'DESC').addOrderBy('disc.id', 'DESC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }

  public async listForReport(
    filter: DiscrepancyReportQuery,
  ): Promise<ReconciliationDiscrepancyEntity[]> {
    if (!this.isDatabaseReady()) return [];
    const qb = this.repository.createQueryBuilder('disc');
    if (filter.runId !== undefined) {
      qb.andWhere('disc.runId = :runId', { runId: filter.runId });
    }
    if (filter.jobId !== undefined) {
      qb.andWhere('disc.jobId = :jobId', { jobId: filter.jobId });
    }
    qb.orderBy('disc.severity', 'DESC').addOrderBy('disc.id', 'DESC');
    return qb.getMany();
  }

  public async listForExport(
    filter: Partial<ListDiscrepanciesQuery>,
    maxRows = 5000,
  ): Promise<ReconciliationDiscrepancyEntity[]> {
    if (!this.isDatabaseReady()) return [];
    const qb = this.repository.createQueryBuilder('disc');
    this.applyFilter(qb, filter);
    qb.orderBy('disc.severity', 'DESC').addOrderBy('disc.id', 'DESC').take(maxRows);
    return qb.getMany();
  }

  private applyFilter(
    qb: SelectQueryBuilder<ReconciliationDiscrepancyEntity>,
    filter: Partial<ListDiscrepanciesQuery>,
  ): void {
    if (filter.runId !== undefined) {
      qb.andWhere('disc.runId = :runId', { runId: filter.runId });
    }
    if (filter.jobId !== undefined) {
      qb.andWhere('disc.jobId = :jobId', { jobId: filter.jobId });
    }
    if (filter.discrepancyType !== undefined) {
      qb.andWhere('disc.discrepancyType = :discrepancyType', {
        discrepancyType: filter.discrepancyType,
      });
    }
    if (filter.severity !== undefined) {
      qb.andWhere('disc.severity = :severity', { severity: filter.severity });
    }
    if (filter.status !== undefined) {
      qb.andWhere('disc.status = :status', { status: filter.status });
    }
    if (filter.assigneeUserId !== undefined) {
      qb.andWhere('disc.assigneeUserId = :assigneeUserId', {
        assigneeUserId: filter.assigneeUserId,
      });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'disc.discrepancyCode',
        'disc.recordKey',
        'disc.entityId',
        'disc.targetModule',
        'disc.resolutionNote',
      ]);
    }
  }
}
