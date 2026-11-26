import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { DrSwitchExecutionEntity } from '../entities/dr-switch-execution.entity.js';
import {
  DR_SWITCH_STATUS,
  type DrSwitchDirection,
  type DrSwitchStatus,
} from '../enum/dr-ops.enum.js';

export interface ListDrSwitchesFilter {
  page?: number | undefined;
  limit?: number | undefined;
  direction?: DrSwitchDirection | undefined;
  status?: DrSwitchStatus | undefined;
}

@Injectable()
export class DrSwitchExecutionRepository extends BaseTypeOrmRepository<DrSwitchExecutionEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DrSwitchExecutionEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<DrSwitchExecutionEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findActiveInProgress(
    profileCode = 'DEFAULT',
  ): Promise<DrSwitchExecutionEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({
      where: { profileCode, status: DR_SWITCH_STATUS.IN_PROGRESS },
      order: { startedAt: 'DESC', id: 'DESC' },
    });
  }

  public async listPaginated(
    filter: ListDrSwitchesFilter,
  ): Promise<PaginatedResult<DrSwitchExecutionEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('sw');
    if (filter.direction) {
      qb.andWhere('sw.direction = :direction', { direction: filter.direction });
    }
    if (filter.status) {
      qb.andWhere('sw.status = :status', { status: filter.status });
    }
    qb.orderBy('sw.startedAt', 'DESC').addOrderBy('sw.id', 'DESC');

    const res = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(res.items, res.nullableTotal, res.page, res.limit);
  }
}
