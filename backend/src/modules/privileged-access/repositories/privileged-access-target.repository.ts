import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import type { PrivilegedTargetType } from '../enum/privileged-access.enum.js';
import { PrivilegedAccessTargetEntity } from '../entities/privileged-access-target.entity.js';

@Injectable()
export class PrivilegedAccessTargetRepository extends BaseTypeOrmRepository<PrivilegedAccessTargetEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PrivilegedAccessTargetEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<PrivilegedAccessTargetEntity>): PrivilegedAccessTargetEntity {
    return this.repository.create(data);
  }

  public async softDeleteEntity(
    entity: PrivilegedAccessTargetEntity,
  ): Promise<PrivilegedAccessTargetEntity> {
    return this.repository.softRemove(entity);
  }

  public async findByTypeAndCode(
    targetType: PrivilegedTargetType,
    targetCode: string,
  ): Promise<PrivilegedAccessTargetEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        targetType,
        targetCode: targetCode.trim(),
      },
    });
  }

  public async findAllEnabled(): Promise<PrivilegedAccessTargetEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { isEnabled: true },
      order: { id: 'ASC' },
    });
  }

  public async findAll(): Promise<PrivilegedAccessTargetEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { id: 'ASC' } });
  }

  public async paginateFiltered(filter: {
    readonly targetType?: PrivilegedTargetType | undefined;
    readonly isEnabled?: boolean | undefined;
    readonly search?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<PrivilegedAccessTargetEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 50);
    }
    const qb = this.repository.createQueryBuilder('t');
    if (filter.targetType) {
      qb.andWhere('t.targetType = :targetType', { targetType: filter.targetType });
    }
    if (filter.isEnabled !== undefined) {
      qb.andWhere('t.isEnabled = :isEnabled', { isEnabled: filter.isEnabled });
    }
    if (filter.search?.trim()) {
      const q = `%${filter.search.trim().toLowerCase()}%`;
      qb.andWhere('(LOWER(t.targetCode) LIKE :q OR LOWER(t.displayName) LIKE :q)', { q });
    }
    qb.orderBy('t.id', 'ASC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
