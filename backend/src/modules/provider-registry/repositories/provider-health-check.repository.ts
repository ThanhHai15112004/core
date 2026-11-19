import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult, ProviderHealthStatusCode } from '@packages/kernel/index.js';
import { ProviderHealthCheckEntity } from '../entities/provider-health-check.entity.js';

export interface ListProviderHealthChecksFilter {
  readonly providerId: number;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly healthStatus?: ProviderHealthStatusCode | undefined;
}

@Injectable()
export class ProviderHealthCheckRepository extends BaseTypeOrmRepository<ProviderHealthCheckEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ProviderHealthCheckEntity, dataSource as DataSource, transactionManager);
  }

  public async listPaginated(
    filter: ListProviderHealthChecksFilter,
  ): Promise<PaginatedResult<ProviderHealthCheckEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository
      .createQueryBuilder('hc')
      .where('hc.providerId = :providerId', { providerId: Number(filter.providerId) });

    if (filter.healthStatus !== undefined) {
      qb.andWhere('hc.healthStatus = :healthStatus', { healthStatus: filter.healthStatus });
    }

    qb.orderBy('hc.checkedAt', 'DESC').addOrderBy('hc.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
