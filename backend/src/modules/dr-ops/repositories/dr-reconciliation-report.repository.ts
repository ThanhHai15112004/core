import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { DrReconciliationReportEntity } from '../entities/dr-reconciliation-report.entity.js';
import type { DrReconcileStatus, DrSyncScope } from '../enum/dr-ops.enum.js';

export interface ListDrReconciliationsFilter {
  page?: number | undefined;
  limit?: number | undefined;
  scope?: DrSyncScope | undefined;
  status?: DrReconcileStatus | undefined;
}

@Injectable()
export class DrReconciliationReportRepository extends BaseTypeOrmRepository<DrReconciliationReportEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DrReconciliationReportEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findLatest(profileCode = 'DEFAULT'): Promise<DrReconciliationReportEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({
      where: { profileCode },
      order: { startedAt: 'DESC', id: 'DESC' },
    });
  }

  public async listPaginated(
    filter: ListDrReconciliationsFilter,
  ): Promise<PaginatedResult<DrReconciliationReportEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('rc');
    if (filter.scope) {
      qb.andWhere('rc.scope = :scope', { scope: filter.scope });
    }
    if (filter.status) {
      qb.andWhere('rc.status = :status', { status: filter.status });
    }
    qb.orderBy('rc.startedAt', 'DESC').addOrderBy('rc.id', 'DESC');

    const res = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(res.items, res.nullableTotal, res.page, res.limit);
  }
}
