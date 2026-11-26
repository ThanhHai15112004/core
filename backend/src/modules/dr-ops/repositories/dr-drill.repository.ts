import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { DrDrillEntity } from '../entities/dr-drill.entity.js';
import type { DrDrillStatus, DrDrillType } from '../enum/dr-ops.enum.js';

export interface ListDrDrillsFilter {
  page?: number | undefined;
  limit?: number | undefined;
  drillType?: DrDrillType | undefined;
  status?: DrDrillStatus | undefined;
}

@Injectable()
export class DrDrillRepository extends BaseTypeOrmRepository<DrDrillEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DrDrillEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findLatest(profileCode = 'DEFAULT'): Promise<DrDrillEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({
      where: { profileCode },
      order: { startedAt: 'DESC', id: 'DESC' },
    });
  }

  public async listPaginated(filter: ListDrDrillsFilter): Promise<PaginatedResult<DrDrillEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('dr');
    if (filter.drillType) {
      qb.andWhere('dr.drillType = :drillType', { drillType: filter.drillType });
    }
    if (filter.status) {
      qb.andWhere('dr.status = :status', { status: filter.status });
    }
    qb.orderBy('dr.startedAt', 'DESC').addOrderBy('dr.id', 'DESC');

    const res = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(res.items, res.nullableTotal, res.page, res.limit);
  }
}
