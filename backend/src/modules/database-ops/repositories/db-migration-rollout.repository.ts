import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { safeJsonParseObject } from '@packages/kernel/index.js';
import {
  DbMigrationRolloutEntity,
  type MigrationRolloutStatus,
} from '../entities/db-migration-rollout.entity.js';

export interface ListRolloutFilter {
  readonly limit?: number | undefined;
  readonly environment?: string | undefined;
  readonly status?: MigrationRolloutStatus | undefined;
}

@Injectable()
export class DbMigrationRolloutRepository extends BaseTypeOrmRepository<DbMigrationRolloutEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DbMigrationRolloutEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async saveSafe(
    data: Partial<DbMigrationRolloutEntity>,
  ): Promise<DbMigrationRolloutEntity | null> {
    if (!this.isDatabaseReady()) return null;
    try {
      return await this.saveEntity(data);
    } catch {
      return null;
    }
  }

  public async listRecent(filter: ListRolloutFilter = {}): Promise<DbMigrationRolloutEntity[]> {
    if (!this.isDatabaseReady()) return [];
    const limit = Math.min(100, Math.max(1, filter.limit ?? 25));
    try {
      const qb = this.repository
        .createQueryBuilder('r')
        .orderBy('r.startedAt', 'DESC')
        .addOrderBy('r.id', 'DESC')
        .take(limit);
      if (filter.environment) {
        qb.andWhere('r.environment = :environment', { environment: filter.environment });
      }
      if (filter.status) {
        qb.andWhere('r.status = :status', { status: filter.status });
      }
      return await qb.getMany();
    } catch {
      return [];
    }
  }

  /**
   * Tổng hợp bản đồ checksum bền vững từ các rollout gần nhất trong DB
   * (bổ sung cho Redis khi Redis bị flush hoặc restart).
   */
  public async findLatestChecksumMap(): Promise<Record<string, string>> {
    if (!this.isDatabaseReady()) return {};
    try {
      const rows = await this.repository.find({
        where: [{ status: 'SUCCESS' }, { status: 'NO_OP' }],
        order: { startedAt: 'DESC', id: 'DESC' },
        take: 10,
      });
      const merged: Record<string, string> = {};
      for (const row of [...rows].reverse()) {
        if (!row.checksumSnapshotJson) continue;
        const parsed = safeJsonParseObject<Record<string, string>>(row.checksumSnapshotJson, {});
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v.length > 0) {
            merged[k] = v;
          }
        }
      }
      return merged;
    } catch {
      return {};
    }
  }
}
