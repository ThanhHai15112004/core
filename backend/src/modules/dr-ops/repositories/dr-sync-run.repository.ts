import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { DrSyncRunEntity } from '../entities/dr-sync-run.entity.js';
import type { DrSyncScope, DrSyncStatus } from '../enum/dr-ops.enum.js';

export interface ListDrSyncRunsFilter {
  page?: number | undefined;
  limit?: number | undefined;
  scope?: DrSyncScope | undefined;
  status?: DrSyncStatus | undefined;
}

@Injectable()
export class DrSyncRunRepository extends BaseTypeOrmRepository<DrSyncRunEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DrSyncRunEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findLatest(profileCode = 'DEFAULT'): Promise<DrSyncRunEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({
      where: { profileCode },
      order: { startedAt: 'DESC', id: 'DESC' },
    });
  }

  public async listPaginated(
    filter: ListDrSyncRunsFilter,
  ): Promise<PaginatedResult<DrSyncRunEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('s');
    if (filter.scope) {
      qb.andWhere('s.scope = :scope', { scope: filter.scope });
    }
    if (filter.status) {
      qb.andWhere('s.status = :status', { status: filter.status });
    }
    qb.orderBy('s.startedAt', 'DESC').addOrderBy('s.id', 'DESC');

    const res = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(res.items, res.nullableTotal, res.page, res.limit);
  }
}
