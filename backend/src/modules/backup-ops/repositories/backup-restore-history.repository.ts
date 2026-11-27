import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { BackupRestoreHistoryEntity } from '../entities/backup-restore-history.entity.js';
import type { RestoreOperationType, RestoreScope, RestoreStatus } from '../enum/backup-ops.enum.js';

export interface ListRestoreHistoriesFilter {
  page?: number | undefined;
  limit?: number | undefined;
  operationType?: RestoreOperationType | undefined;
  scope?: RestoreScope | undefined;
  status?: RestoreStatus | undefined;
  search?: string | undefined;
}

@Injectable()
export class BackupRestoreHistoryRepository extends BaseTypeOrmRepository<BackupRestoreHistoryEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(BackupRestoreHistoryEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async listPaginated(
    filter: ListRestoreHistoriesFilter,
  ): Promise<PaginatedResult<BackupRestoreHistoryEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('h');
    if (filter.operationType) {
      qb.andWhere('h.operationType = :operationType', { operationType: filter.operationType });
    }
    if (filter.scope) {
      qb.andWhere('h.scope = :scope', { scope: filter.scope });
    }
    if (filter.status) {
      qb.andWhere('h.status = :status', { status: filter.status });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'h.restoreCode',
        'h.backupCode',
        'h.actorName',
        'h.reason',
        'h.targetEnvironment',
      ]);
    }
    qb.orderBy('h.startedAt', 'DESC').addOrderBy('h.id', 'DESC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
