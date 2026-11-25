import { Injectable, Optional } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { DataRepairRequestEntity } from '../entities/data-repair-request.entity.js';
import type { ListDataRepairsQuery } from '../requests/reconciliation.requests.js';

@Injectable()
export class DataRepairRequestRepository extends BaseTypeOrmRepository<DataRepairRequestEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DataRepairRequestEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<DataRepairRequestEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByRepairCode(repairCode: string): Promise<DataRepairRequestEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { repairCode } });
  }

  public async listPaginated(
    filter: ListDataRepairsQuery,
  ): Promise<PaginatedResult<DataRepairRequestEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('req');

    if (filter.discrepancyId !== undefined) {
      qb.andWhere('req.discrepancyId = :discrepancyId', { discrepancyId: filter.discrepancyId });
    }
    if (filter.status !== undefined) {
      qb.andWhere('req.status = :status', { status: filter.status });
    }
    if (filter.actionMode) {
      qb.andWhere('req.actionMode = :actionMode', { actionMode: filter.actionMode });
    }
    if (filter.isSensitive !== undefined) {
      qb.andWhere('req.isSensitive = :isSensitive', { isSensitive: filter.isSensitive });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'req.repairCode',
        'req.handlerCode',
        'req.targetModule',
        'req.targetEntityType',
        'req.targetEntityId',
        'req.reason',
      ]);
    }

    qb.orderBy('req.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }

  public async listByParentRepairId(parentRepairId: number): Promise<DataRepairRequestEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository.find({
      where: { parentRepairId },
      order: { id: 'ASC' },
    });
  }
}
