import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { SiemDispatchLogEntity } from '../entities/siem-dispatch-log.entity.js';
import type { SiemDispatchStatus } from '../enum/incidents-ops.enum.js';

export interface ListSiemLogsFilter {
  page?: number | undefined;
  limit?: number | undefined;
  status?: SiemDispatchStatus | undefined;
  eventType?: string | undefined;
  search?: string | undefined;
}

@Injectable()
export class SiemDispatchLogRepository extends BaseTypeOrmRepository<SiemDispatchLogEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(SiemDispatchLogEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async countLast24h(): Promise<{ sent: number; failed: number }> {
    if (!this.isDatabaseReady()) return { sent: 0, failed: 0 };
    const since = new Date(Date.now() - 24 * 3600_000);
    const agg = (await this.repository
      .createQueryBuilder('log')
      .select("SUM(CASE WHEN log.status = 'SENT' THEN 1 ELSE 0 END)", 'sent')
      .addSelect("SUM(CASE WHEN log.status = 'FAILED' THEN 1 ELSE 0 END)", 'failed')
      .where('log.dispatchedAt >= :since', { since })
      .getRawOne()) as
      { sent?: string | number | null; failed?: string | number | null } | undefined;

    return {
      sent: Number(agg?.sent ?? 0),
      failed: Number(agg?.failed ?? 0),
    };
  }

  public async listPaginated(
    filter: ListSiemLogsFilter,
  ): Promise<PaginatedResult<SiemDispatchLogEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('log');
    if (filter.status) {
      qb.andWhere('log.status = :status', { status: filter.status });
    }
    if (filter.eventType?.trim()) {
      qb.andWhere('log.eventType = :eventType', { eventType: filter.eventType.trim() });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'log.eventType',
        'log.alertCode',
        'log.destination',
        'log.errorMessage',
      ]);
    }
    qb.orderBy('log.dispatchedAt', 'DESC').addOrderBy('log.id', 'DESC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
