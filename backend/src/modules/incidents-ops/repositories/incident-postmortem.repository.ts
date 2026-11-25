import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { IncidentPostmortemEntity } from '../entities/incident-postmortem.entity.js';
import type { PostmortemStatus } from '../enum/incidents-ops.enum.js';

export interface ListPostmortemsFilter {
  page?: number | undefined;
  limit?: number | undefined;
  status?: PostmortemStatus | undefined;
  search?: string | undefined;
}

@Injectable()
export class IncidentPostmortemRepository extends BaseTypeOrmRepository<IncidentPostmortemEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(IncidentPostmortemEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIncidentId(incidentId: number): Promise<IncidentPostmortemEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { incidentId } });
  }

  public async listPaginated(
    filter: ListPostmortemsFilter,
  ): Promise<PaginatedResult<IncidentPostmortemEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('pm');
    if (filter.status) {
      qb.andWhere('pm.status = :status', { status: filter.status });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, ['pm.incidentCode', 'pm.title', 'pm.summary']);
    }
    qb.orderBy('pm.updatedAt', 'DESC').addOrderBy('pm.id', 'DESC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
