import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ComplianceCheckHistoryEntity } from '../entities/compliance-check-history.entity.js';
import type { ControlCheckResult } from '../enum/compliance.enum.js';

@Injectable()
export class ComplianceCheckHistoryRepository extends BaseTypeOrmRepository<ComplianceCheckHistoryEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ComplianceCheckHistoryEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<ComplianceCheckHistoryEntity>): ComplianceCheckHistoryEntity {
    return this.repository.create(data);
  }

  public async findAll(): Promise<ComplianceCheckHistoryEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { checkedAt: 'DESC', id: 'DESC' } });
  }

  public async paginateFiltered(filter: {
    readonly controlId?: number | undefined;
    readonly checkedByUserId?: number | undefined;
    readonly result?: ControlCheckResult | undefined;
    readonly fromDate?: Date | undefined;
    readonly toDate?: Date | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<ComplianceCheckHistoryEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 50);
    }

    const qb = this.repository.createQueryBuilder('h');
    if (filter.controlId !== undefined) {
      qb.andWhere('h.controlId = :controlId', { controlId: filter.controlId });
    }
    if (filter.checkedByUserId !== undefined) {
      qb.andWhere('h.checkedByUserId = :checkedBy', { checkedBy: filter.checkedByUserId });
    }
    if (filter.result) {
      qb.andWhere('h.result = :result', { result: filter.result });
    }
    if (filter.fromDate) {
      qb.andWhere('h.checkedAt >= :fromDate', { fromDate: filter.fromDate });
    }
    if (filter.toDate) {
      qb.andWhere('h.checkedAt <= :toDate', { toDate: filter.toDate });
    }

    qb.orderBy('h.checkedAt', 'DESC').addOrderBy('h.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
