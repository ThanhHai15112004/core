import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { BackupRecordEntity } from '../entities/backup-record.entity.js';
import {
  BACKUP_RECORD_STATUS,
  BACKUP_VERIFY_STATUS,
  type BackupRecordStatus,
  type BackupTargetType,
  type BackupVerifyStatus,
} from '../enum/backup-ops.enum.js';

export interface ListBackupRecordsFilter {
  page?: number | undefined;
  limit?: number | undefined;
  targetType?: BackupTargetType | undefined;
  status?: BackupRecordStatus | undefined;
  verifyStatus?: BackupVerifyStatus | undefined;
  policyCode?: string | undefined;
  search?: string | undefined;
}

@Injectable()
export class BackupRecordRepository extends BaseTypeOrmRepository<BackupRecordEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(BackupRecordEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<BackupRecordEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findLatestByTarget(
    targetType: BackupTargetType,
    onlySuccess = false,
  ): Promise<BackupRecordEntity | null> {
    if (!this.isDatabaseReady()) return null;
    const where = onlySuccess
      ? { targetType, status: BACKUP_RECORD_STATUS.SUCCESS }
      : { targetType };
    return this.repository.findOne({
      where,
      order: { startedAt: 'DESC', id: 'DESC' },
    });
  }

  public async findLatestForVerifyDrill(): Promise<BackupRecordEntity | null> {
    if (!this.isDatabaseReady()) return null;
    const pending = await this.repository.findOne({
      where: {
        targetType: 'DATABASE',
        status: BACKUP_RECORD_STATUS.SUCCESS,
        verifyStatus: BACKUP_VERIFY_STATUS.PENDING,
      },
      order: { startedAt: 'DESC', id: 'DESC' },
    });
    if (pending) return pending;
    return this.findLatestByTarget('DATABASE', true);
  }

  public async listSuccessfulRecords(): Promise<BackupRecordEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository.find({
      where: { status: BACKUP_RECORD_STATUS.SUCCESS },
      order: { startedAt: 'DESC', id: 'DESC' },
    });
  }

  public async getStatsSnapshot(): Promise<{
    totalRecords: number;
    successfulRecords: number;
    failedRecords24h: number;
    totalStoredBytes: number;
    drillTotalCount: number;
    drillPassedCount: number;
  }> {
    if (!this.isDatabaseReady()) {
      return {
        totalRecords: 0,
        successfulRecords: 0,
        failedRecords24h: 0,
        totalStoredBytes: 0,
        drillTotalCount: 0,
        drillPassedCount: 0,
      };
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [totalRecords, successfulRecords, failedRecords24h, drillTotalCount, drillPassedCount] =
      await Promise.all([
        this.repository.count(),
        this.repository.count({ where: { status: BACKUP_RECORD_STATUS.SUCCESS } }),
        this.repository
          .createQueryBuilder('r')
          .where('r.status = :status', { status: BACKUP_RECORD_STATUS.FAILED })
          .andWhere('r.startedAt >= :since', { since: since24h })
          .getCount(),
        this.repository
          .createQueryBuilder('r')
          .where('r.verifyStatus IN (:...statuses)', {
            statuses: [BACKUP_VERIFY_STATUS.PASSED, BACKUP_VERIFY_STATUS.FAILED],
          })
          .getCount(),
        this.repository.count({ where: { verifyStatus: BACKUP_VERIFY_STATUS.PASSED } }),
      ]);

    const rawBytes = (await this.repository
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.storedSizeBytes), 0)', 'totalBytes')
      .where('r.status = :status', { status: BACKUP_RECORD_STATUS.SUCCESS })
      .getRawOne()) as { totalBytes?: string | number | null } | undefined;

    return {
      totalRecords,
      successfulRecords,
      failedRecords24h,
      totalStoredBytes: Number(rawBytes?.totalBytes ?? 0),
      drillTotalCount,
      drillPassedCount,
    };
  }

  public async listPaginated(
    filter: ListBackupRecordsFilter,
  ): Promise<PaginatedResult<BackupRecordEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('r');
    if (filter.targetType) {
      qb.andWhere('r.targetType = :targetType', { targetType: filter.targetType });
    }
    if (filter.status) {
      qb.andWhere('r.status = :status', { status: filter.status });
    }
    if (filter.verifyStatus) {
      qb.andWhere('r.verifyStatus = :verifyStatus', { verifyStatus: filter.verifyStatus });
    }
    if (filter.policyCode) {
      qb.andWhere('r.policyCode = :policyCode', { policyCode: filter.policyCode });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'r.backupCode',
        'r.policyCode',
        'r.storageKey',
        'r.triggeredByName',
      ]);
    }
    qb.orderBy('r.startedAt', 'DESC').addOrderBy('r.id', 'DESC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
