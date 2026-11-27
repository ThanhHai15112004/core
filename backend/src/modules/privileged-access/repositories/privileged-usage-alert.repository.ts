import { Injectable, Optional } from '@nestjs/common';
import { DataSource, IsNull, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { PrivilegedUsageAlertEntity } from '../entities/privileged-usage-alert.entity.js';

@Injectable()
export class PrivilegedUsageAlertRepository extends BaseTypeOrmRepository<PrivilegedUsageAlertEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PrivilegedUsageAlertEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<PrivilegedUsageAlertEntity>): PrivilegedUsageAlertEntity {
    return this.repository.create(data);
  }

  public async countUnacknowledged(): Promise<number> {
    if (!this.dataSource?.isInitialized) return 0;
    return this.repository.count({ where: { acknowledgedAt: IsNull() } });
  }

  public async paginateFiltered(filter: {
    readonly eventType?: string | undefined;
    readonly severity?: string | undefined;
    readonly actorUserId?: number | undefined;
    readonly unacknowledgedOnly?: boolean | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<PrivilegedUsageAlertEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }
    const qb = this.repository.createQueryBuilder('a');
    if (filter.eventType?.trim()) {
      qb.andWhere('a.eventType = :eventType', { eventType: filter.eventType.trim() });
    }
    if (filter.severity?.trim()) {
      qb.andWhere('a.severity = :severity', { severity: filter.severity.trim().toUpperCase() });
    }
    if (filter.actorUserId !== undefined) {
      qb.andWhere('a.actorUserId = :actorUserId', { actorUserId: Number(filter.actorUserId) });
    }
    if (filter.unacknowledgedOnly === true) {
      qb.andWhere('a.acknowledgedAt IS NULL');
    }
    qb.orderBy('a.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 20,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
