import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult, ProviderTypeName } from '@packages/kernel/index.js';
import { ProviderConfigHistoryEntity } from '../entities/provider-config-history.entity.js';

export interface ListProviderConfigHistoriesFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly providerId?: number | undefined;
  readonly providerType?: ProviderTypeName | undefined;
  readonly providerCode?: string | undefined;
  readonly action?: string | undefined;
  readonly search?: string | undefined;
}

@Injectable()
export class ProviderConfigHistoryRepository extends BaseTypeOrmRepository<ProviderConfigHistoryEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ProviderConfigHistoryEntity, dataSource as DataSource, transactionManager);
  }

  public async listPaginated(
    filter: ListProviderConfigHistoriesFilter,
  ): Promise<PaginatedResult<ProviderConfigHistoryEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('hist');
    if (filter.providerId !== undefined) {
      qb.andWhere('hist.providerId = :providerId', { providerId: Number(filter.providerId) });
    }
    if (filter.providerType) {
      qb.andWhere('hist.providerType = :providerType', { providerType: filter.providerType });
    }
    if (filter.providerCode?.trim()) {
      qb.andWhere('hist.providerCode = :providerCode', {
        providerCode: filter.providerCode.trim().toLowerCase(),
      });
    }
    if (filter.action?.trim()) {
      qb.andWhere('hist.action = :action', { action: filter.action.trim().toUpperCase() });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'hist.providerCode',
        'hist.reason',
        'hist.actorIdentifier',
        'hist.action',
      ]);
    }

    qb.orderBy('hist.createdAt', 'DESC').addOrderBy('hist.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
