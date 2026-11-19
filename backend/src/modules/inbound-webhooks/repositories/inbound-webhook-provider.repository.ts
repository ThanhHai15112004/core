import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { InboundWebhookProviderStatusCode } from '../enum/inbound-webhooks.enum.js';
import { InboundWebhookProviderEntity } from '../entities/inbound-webhook-provider.entity.js';

export interface ListInboundWebhookProvidersFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly status?: InboundWebhookProviderStatusCode | undefined;
  readonly search?: string | undefined;
}

@Injectable()
export class InboundWebhookProviderRepository extends BaseTypeOrmRepository<InboundWebhookProviderEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(InboundWebhookProviderEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<InboundWebhookProviderEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByCode(providerCode: string): Promise<InboundWebhookProviderEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { providerCode: providerCode.trim().toLowerCase() },
    });
  }

  public async findByIds(ids: readonly number[]): Promise<InboundWebhookProviderEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    const uniqueIds = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    if (uniqueIds.length === 0) return [];
    return this.repository.find({ where: { id: In(uniqueIds) } });
  }

  public async listPaginated(
    filter: ListInboundWebhookProvidersFilter,
  ): Promise<PaginatedResult<InboundWebhookProviderEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('provider');

    if (filter.status !== undefined) {
      qb.andWhere('provider.status = :status', { status: filter.status });
    }

    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'provider.providerCode',
        'provider.name',
        'provider.description',
      ]);
    }

    qb.orderBy('provider.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
