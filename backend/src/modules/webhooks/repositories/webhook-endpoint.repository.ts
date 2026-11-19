import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { WEBHOOK_ENDPOINT_STATUS, type WebhookEndpointStatusCode } from '../enum/webhooks.enum.js';
import { WebhookEndpointEntity } from '../entities/webhook-endpoint.entity.js';

export interface ListWebhookEndpointsFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly status?: WebhookEndpointStatusCode | undefined;
  readonly search?: string | undefined;
}

@Injectable()
export class WebhookEndpointRepository extends BaseTypeOrmRepository<WebhookEndpointEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(WebhookEndpointEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<WebhookEndpointEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByIds(ids: readonly number[]): Promise<WebhookEndpointEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    const uniqueIds = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    if (uniqueIds.length === 0) return [];
    return this.repository.find({ where: { id: In(uniqueIds) } });
  }

  public async findAllActive(): Promise<WebhookEndpointEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { status: WEBHOOK_ENDPOINT_STATUS.ACTIVE },
      order: { id: 'ASC' },
    });
  }

  public async listPaginated(
    filter: ListWebhookEndpointsFilter,
  ): Promise<PaginatedResult<WebhookEndpointEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('endpoint');

    if (filter.status !== undefined) {
      qb.andWhere('endpoint.status = :status', { status: filter.status });
    }

    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'endpoint.name',
        'endpoint.targetUrl',
        'endpoint.description',
      ]);
    }

    qb.orderBy('endpoint.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
