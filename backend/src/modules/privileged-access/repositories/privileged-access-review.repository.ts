import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import {
  ACCESS_REVIEW_STATUS,
  type AccessReviewStatusCode,
} from '../enum/privileged-access.enum.js';
import { PrivilegedAccessReviewEntity } from '../entities/privileged-access-review.entity.js';

@Injectable()
export class PrivilegedAccessReviewRepository extends BaseTypeOrmRepository<PrivilegedAccessReviewEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PrivilegedAccessReviewEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<PrivilegedAccessReviewEntity>): PrivilegedAccessReviewEntity {
    return this.repository.create(data);
  }

  public async countOpen(): Promise<number> {
    if (!this.dataSource?.isInitialized) return 0;
    return this.repository.count({ where: { status: ACCESS_REVIEW_STATUS.OPEN } });
  }

  public async findLatest(): Promise<PrivilegedAccessReviewEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    const rows = await this.repository.find({
      order: { id: 'DESC' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  public async paginateFiltered(filter: {
    readonly status?: AccessReviewStatusCode | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<PrivilegedAccessReviewEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }
    const qb = this.repository.createQueryBuilder('r');
    if (filter.status !== undefined) {
      qb.andWhere('r.status = :status', { status: filter.status });
    }
    qb.orderBy('r.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 20,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
