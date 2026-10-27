import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { ReportScheduleEntity } from '../entities/report-schedule.entity.js';

@Injectable()
export class ReportScheduleRepository extends BaseTypeOrmRepository<ReportScheduleEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ReportScheduleEntity, dataSource as DataSource, transactionManager);
  }

  public override async findById(id: number): Promise<ReportScheduleEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async createRecord(
    payload: Partial<ReportScheduleEntity>,
  ): Promise<ReportScheduleEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.saveEntity(payload);
  }

  public async updateById(
    id: number,
    patch: Partial<ReportScheduleEntity>,
  ): Promise<ReportScheduleEntity | null> {
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
    readonly frequency?: string | undefined;
    readonly isActive?: boolean | undefined;
  }): Promise<ReportScheduleEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    const qb = this.repository.createQueryBuilder('s').orderBy('s.id', 'DESC');
    if (filter?.module) {
      qb.andWhere('LOWER(s.module) = LOWER(:module)', { module: filter.module.trim() });
    }
    if (filter?.reportCode) {
      qb.andWhere('LOWER(s.report_code) = LOWER(:reportCode)', {
        reportCode: filter.reportCode.trim(),
      });
    }
    if (filter?.frequency) {
      qb.andWhere('s.frequency = :frequency', { frequency: filter.frequency });
    }
    if (filter?.isActive !== undefined) {
      qb.andWhere('s.is_active = :isActive', { isActive: filter.isActive });
    }
    return qb.getMany();
  }
}
