import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ScimReconciliationRunEntity } from '../entities/scim-reconciliation-run.entity.js';

export interface ListScimReconciliationsFilter {
  readonly clientId?: number | undefined;
  readonly mode?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

@Injectable()
export class ScimReconciliationRunRepository extends BaseTypeOrmRepository<ScimReconciliationRunEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ScimReconciliationRunEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<ScimReconciliationRunEntity>): ScimReconciliationRunEntity {
    return this.repository.create(data);
  }

  public override async findById(id: number): Promise<ScimReconciliationRunEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async listPaginated(
    filter: ListScimReconciliationsFilter,
  ): Promise<PaginatedResult<ScimReconciliationRunEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('run');

    if (filter.clientId !== undefined) {
      qb.andWhere('run.clientId = :clientId', { clientId: filter.clientId });
    }
    if (filter.mode?.trim()) {
      qb.andWhere('run.mode = :mode', { mode: filter.mode.trim().toUpperCase() });
    }

    qb.orderBy('run.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
