import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { AlertOwnerMappingEntity } from '../entities/alert-owner-mapping.entity.js';
import type { IncidentSeverity, IncidentSource } from '../enum/incidents-ops.enum.js';

export interface ListOwnerMappingsFilter {
  page?: number | undefined;
  limit?: number | undefined;
  source?: IncidentSource | undefined;
  severity?: IncidentSeverity | undefined;
  ownerUserId?: number | undefined;
  isEnabled?: boolean | undefined;
  search?: string | undefined;
}

@Injectable()
export class AlertOwnerMappingRepository extends BaseTypeOrmRepository<AlertOwnerMappingEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(AlertOwnerMappingEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<AlertOwnerMappingEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByAlertCode(alertCode: string): Promise<AlertOwnerMappingEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { alertCode } });
  }

  public async listPaginated(
    filter: ListOwnerMappingsFilter,
  ): Promise<PaginatedResult<AlertOwnerMappingEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('m');
    if (filter.source) {
      qb.andWhere('m.source = :source', { source: filter.source });
    }
    if (filter.severity) {
      qb.andWhere('m.defaultSeverity = :severity', { severity: filter.severity });
    }
    if (filter.ownerUserId !== undefined) {
      qb.andWhere('m.ownerUserId = :ownerUserId', { ownerUserId: filter.ownerUserId });
    }
    if (filter.isEnabled !== undefined) {
      qb.andWhere('m.isEnabled = :isEnabled', { isEnabled: filter.isEnabled });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, ['m.alertCode', 'm.alertName']);
    }
    qb.orderBy('m.isSystem', 'DESC').addOrderBy('m.id', 'DESC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
