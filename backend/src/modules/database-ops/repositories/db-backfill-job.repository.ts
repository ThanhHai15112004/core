import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import {
  DbBackfillJobEntity,
  type DbBackfillJobStatus,
} from '../entities/db-backfill-job.entity.js';

@Injectable()
export class DbBackfillJobRepository extends BaseTypeOrmRepository<DbBackfillJobEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DbBackfillJobEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<DbBackfillJobEntity | null> {
    if (!this.isDatabaseReady()) return null;
    try {
      return await this.repository.findOne({ where: { id } });
    } catch {
      return null;
    }
  }

  public async listRecent(limit = 30): Promise<DbBackfillJobEntity[]> {
    if (!this.isDatabaseReady()) return [];
    try {
      return await this.repository.find({
        order: { id: 'DESC' },
        take: Math.min(100, Math.max(1, limit)),
      });
    } catch {
      return [];
    }
  }

  public async updateFieldsSafe(
    id: number,
    patch: Partial<DbBackfillJobEntity>,
  ): Promise<DbBackfillJobEntity | null> {
    if (!this.isDatabaseReady()) return null;
    try {
      const existing = await this.findByIdSafe(id);
      if (!existing) return null;
      return await this.saveEntity({ ...existing, ...patch, id });
    } catch {
      return null;
    }
  }

  public async isCancelRequested(id: number): Promise<boolean> {
    const row = await this.findByIdSafe(id);
    return Boolean(row?.cancelRequested || row?.status === ('CANCELLED' as DbBackfillJobStatus));
  }
}
