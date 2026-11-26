import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ScimSyncLogEntity } from '../entities/scim-sync-log.entity.js';

export interface ListScimSyncLogsFilter {
  readonly clientId?: number | undefined;
  readonly resourceType?: string | undefined;
  readonly outcome?: string | undefined;
  readonly operation?: string | undefined;
  readonly externalId?: string | undefined;
  readonly search?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

@Injectable()
export class ScimSyncLogRepository extends BaseTypeOrmRepository<ScimSyncLogEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ScimSyncLogEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<ScimSyncLogEntity>): ScimSyncLogEntity {
    return this.repository.create(data);
  }

  public async listPaginated(
    filter: ListScimSyncLogsFilter,
  ): Promise<PaginatedResult<ScimSyncLogEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('log');

    if (filter.clientId !== undefined) {
      qb.andWhere('log.clientId = :clientId', { clientId: filter.clientId });
    }
    if (filter.resourceType?.trim()) {
      qb.andWhere('log.resourceType = :resourceType', {
        resourceType: filter.resourceType.trim(),
      });
    }
    if (filter.outcome?.trim()) {
      qb.andWhere('log.outcome = :outcome', {
        outcome: filter.outcome.trim().toUpperCase(),
      });
    }
    if (filter.operation?.trim()) {
      qb.andWhere('log.operation = :operation', {
        operation: filter.operation.trim().toUpperCase(),
      });
    }
    if (filter.externalId?.trim()) {
      qb.andWhere('log.externalId = :externalId', {
        externalId: filter.externalId.trim(),
      });
    }
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim().toLowerCase()}%`;
      qb.andWhere(
        "(LOWER(COALESCE(log.externalId, '')) LIKE :term OR LOWER(COALESCE(log.resourceId, '')) LIKE :term OR LOWER(COALESCE(log.errorMessage, '')) LIKE :term OR LOWER(log.httpPath) LIKE :term)",
        { term },
      );
    }

    qb.orderBy('log.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
