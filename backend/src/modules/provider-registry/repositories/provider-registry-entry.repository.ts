import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type {
  PaginatedResult,
  ProviderHealthStatusCode,
  ProviderStatusCode,
  ProviderTypeName,
} from '@packages/kernel/index.js';
import { ProviderRegistryEntryEntity } from '../entities/provider-registry-entry.entity.js';

export interface ListProviderEntriesFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly providerType?: ProviderTypeName | undefined;
  readonly status?: ProviderStatusCode | undefined;
  readonly healthStatus?: ProviderHealthStatusCode | undefined;
  readonly isPrimary?: boolean | undefined;
  readonly search?: string | undefined;
}

@Injectable()
export class ProviderRegistryEntryRepository extends BaseTypeOrmRepository<ProviderRegistryEntryEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ProviderRegistryEntryEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<ProviderRegistryEntryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id: Number(id) } });
  }

  public async findByTypeAndCode(
    providerType: ProviderTypeName,
    providerCode: string,
    withDeleted = false,
  ): Promise<ProviderRegistryEntryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        providerType,
        providerCode: providerCode.trim().toLowerCase(),
      },
      withDeleted,
    });
  }

  public async listAll(): Promise<ProviderRegistryEntryEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      order: { providerType: 'ASC', isPrimary: 'DESC', priority: 'ASC', id: 'ASC' },
    });
  }

  public async clearPrimaryFlagExcept(
    providerType: ProviderTypeName,
    excludeId: number,
  ): Promise<void> {
    if (!this.dataSource?.isInitialized) return;
    await this.repository
      .createQueryBuilder()
      .update(ProviderRegistryEntryEntity)
      .set({ isPrimary: false })
      .where('provider_type = :providerType AND id != :excludeId AND is_primary = :isPrimary', {
        providerType,
        excludeId: Number(excludeId),
        isPrimary: true,
      })
      .execute();
  }

  public async listPaginated(
    filter: ListProviderEntriesFilter,
  ): Promise<PaginatedResult<ProviderRegistryEntryEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('entry');
    if (filter.providerType) {
      qb.andWhere('entry.providerType = :providerType', { providerType: filter.providerType });
    }
    if (filter.status !== undefined) {
      qb.andWhere('entry.status = :status', { status: filter.status });
    }
    if (filter.healthStatus !== undefined) {
      qb.andWhere('entry.healthStatus = :healthStatus', { healthStatus: filter.healthStatus });
    }
    if (filter.isPrimary !== undefined) {
      qb.andWhere('entry.isPrimary = :isPrimary', { isPrimary: filter.isPrimary });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'entry.providerCode',
        'entry.displayName',
        'entry.driverCode',
        'entry.domainRefCode',
      ]);
    }

    qb.orderBy('entry.providerType', 'ASC')
      .addOrderBy('entry.isPrimary', 'DESC')
      .addOrderBy('entry.priority', 'ASC')
      .addOrderBy('entry.id', 'ASC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
