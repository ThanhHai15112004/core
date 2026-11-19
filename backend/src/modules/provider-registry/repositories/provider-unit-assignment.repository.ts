import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult, ProviderTypeName } from '@packages/kernel/index.js';
import { ProviderUnitAssignmentEntity } from '../entities/provider-unit-assignment.entity.js';

export interface ListProviderUnitAssignmentsFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly providerType?: ProviderTypeName | undefined;
  readonly organizationUnitId?: number | undefined;
  readonly isEnabled?: boolean | undefined;
}

@Injectable()
export class ProviderUnitAssignmentRepository extends BaseTypeOrmRepository<ProviderUnitAssignmentEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ProviderUnitAssignmentEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<ProviderUnitAssignmentEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id: Number(id) } });
  }

  public async findByTypeAndOrgUnit(
    providerType: ProviderTypeName,
    organizationUnitId: number,
    withDeleted = false,
  ): Promise<ProviderUnitAssignmentEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        providerType,
        organizationUnitId: Number(organizationUnitId),
      },
      withDeleted,
    });
  }

  public async listAll(): Promise<ProviderUnitAssignmentEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      order: { providerType: 'ASC', organizationUnitId: 'ASC', id: 'ASC' },
    });
  }

  public async clearReferencesToProvider(providerId: number): Promise<void> {
    if (!this.dataSource?.isInitialized) return;
    await this.repository
      .createQueryBuilder()
      .update(ProviderUnitAssignmentEntity)
      .set({ fallbackProviderId: null })
      .where('fallback_provider_id = :providerId', { providerId: Number(providerId) })
      .execute();
  }

  public async listPaginated(
    filter: ListProviderUnitAssignmentsFilter,
  ): Promise<PaginatedResult<ProviderUnitAssignmentEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('assign');
    if (filter.providerType) {
      qb.andWhere('assign.providerType = :providerType', { providerType: filter.providerType });
    }
    if (filter.organizationUnitId !== undefined) {
      qb.andWhere('assign.organizationUnitId = :organizationUnitId', {
        organizationUnitId: Number(filter.organizationUnitId),
      });
    }
    if (filter.isEnabled !== undefined) {
      qb.andWhere('assign.isEnabled = :isEnabled', { isEnabled: filter.isEnabled });
    }

    qb.orderBy('assign.providerType', 'ASC').addOrderBy('assign.organizationUnitId', 'ASC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
