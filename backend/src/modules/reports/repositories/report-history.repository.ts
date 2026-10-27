import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { ReportHistoryEntity } from '../entities/report-history.entity.js';

@Injectable()
export class ReportHistoryRepository extends BaseTypeOrmRepository<ReportHistoryEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ReportHistoryEntity, dataSource as DataSource, transactionManager);
  }

  public override async findById(id: number): Promise<ReportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByToken(token: string): Promise<ReportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { downloadToken: token.trim() } });
  }

  public async createRecord(
    payload: Partial<ReportHistoryEntity>,
  ): Promise<ReportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.saveEntity(payload);
  }

  public async updateById(
    id: number,
    patch: Partial<ReportHistoryEntity>,
  ): Promise<ReportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    const existing = await this.findById(id);
    if (!existing) return null;
    return this.saveEntity({
      ...existing,
      ...patch,
      id: existing.id,
    });
  }

  public async deleteById(id: number): Promise<boolean> {
    if (!this.dataSource?.isInitialized) return false;
    const res = await this.repository.delete({ id });
    return (res.affected ?? 0) > 0;
  }

  public async listFiltered(filter?: {
    readonly module?: string | undefined;
    readonly reportCode?: string | undefined;
    readonly actorId?: number | undefined;
    readonly status?: string | undefined;
    readonly executionMode?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<ReportHistoryEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    const qb = this.repository.createQueryBuilder('h').orderBy('h.id', 'DESC');
    if (filter?.module) {
      qb.andWhere('LOWER(h.module) = LOWER(:module)', { module: filter.module.trim() });
    }
    if (filter?.reportCode) {
      qb.andWhere('LOWER(h.report_code) = LOWER(:reportCode)', {
        reportCode: filter.reportCode.trim(),
      });
    }
    if (filter?.actorId !== undefined) {
      qb.andWhere('h.actor_id = :actorId', { actorId: filter.actorId });
    }
    if (filter?.status) {
      qb.andWhere('h.status = :status', { status: filter.status });
    }
    if (filter?.executionMode) {
      qb.andWhere('h.execution_mode = :executionMode', { executionMode: filter.executionMode });
    }
    qb.take(Math.max(1, Math.min(200, filter?.limit ?? 50)));
    return qb.getMany();
  }
}
