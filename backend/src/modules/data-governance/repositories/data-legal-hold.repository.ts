import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { LEGAL_HOLD_STATUS, type LegalHoldScopeType } from '../enum/data-governance.enum.js';
import { DataLegalHoldEntity } from '../entities/data-legal-hold.entity.js';

@Injectable()
export class DataLegalHoldRepository extends BaseTypeOrmRepository<DataLegalHoldEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DataLegalHoldEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<DataLegalHoldEntity>): DataLegalHoldEntity {
    return this.repository.create(data);
  }

  public async findAllActive(): Promise<DataLegalHoldEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { holdStatus: LEGAL_HOLD_STATUS.ACTIVE },
      order: { id: 'DESC' },
    });
  }

  public async findExpiredActiveHolds(now: Date): Promise<DataLegalHoldEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository
      .createQueryBuilder('h')
      .where('h.holdStatus = :status', { status: LEGAL_HOLD_STATUS.ACTIVE })
      .andWhere('h.expiresAt IS NOT NULL')
      .andWhere('h.expiresAt <= :now', { now })
      .getMany();
  }

  public async paginateFiltered(filter: {
    readonly scopeType?: LegalHoldScopeType | undefined;
    readonly targetUserId?: number | undefined;
    readonly holdStatus?: number | undefined;
    readonly search?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<DataLegalHoldEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 25);
    }
    const qb = this.repository.createQueryBuilder('h');
    if (filter.scopeType) {
      qb.andWhere('h.scopeType = :scopeType', { scopeType: filter.scopeType });
    }
    if (filter.targetUserId !== undefined) {
      qb.andWhere('h.targetUserId = :targetUserId', { targetUserId: filter.targetUserId });
    }
    if (filter.holdStatus !== undefined) {
      qb.andWhere('h.holdStatus = :holdStatus', { holdStatus: filter.holdStatus });
    }
    if (filter.search?.trim()) {
      const q = `%${filter.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(h.holdCode) LIKE :q OR LOWER(h.title) LIKE :q OR LOWER(COALESCE(h.caseReference, \'\')) LIKE :q)',
        { q },
      );
    }
    qb.orderBy('h.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 25,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
