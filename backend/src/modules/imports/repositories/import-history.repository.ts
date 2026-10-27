import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { ImportHistoryEntity } from '../entities/import-history.entity.js';

@Injectable()
export class ImportHistoryRepository extends BaseTypeOrmRepository<ImportHistoryEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ImportHistoryEntity, dataSource as DataSource, transactionManager);
  }

  public override async findById(id: number): Promise<ImportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByJobId(jobId: string): Promise<ImportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { jobId } });
  }

  public async createRecord(
    payload: Partial<ImportHistoryEntity>,
  ): Promise<ImportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.saveEntity(payload);
  }

  public async updateById(
    id: number,
    patch: Partial<ImportHistoryEntity>,
  ): Promise<ImportHistoryEntity | null> {
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
    readonly profileCode?: string | undefined;
    readonly module?: string | undefined;
    readonly actorId?: number | undefined;
    readonly status?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<ImportHistoryEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    const qb = this.repository.createQueryBuilder('h').orderBy('h.id', 'DESC');
    if (filter?.profileCode) {
      qb.andWhere('LOWER(h.profile_code) = LOWER(:profileCode)', {
        profileCode: filter.profileCode.trim(),
      });
    }
    if (filter?.module) {
      qb.andWhere('LOWER(h.module) = LOWER(:module)', {
        module: filter.module.trim(),
      });
    }
    if (filter?.actorId !== undefined) {
      qb.andWhere('h.actor_id = :actorId', { actorId: filter.actorId });
    }
    if (filter?.status) {
      qb.andWhere('h.status = :status', { status: filter.status });
    }
    qb.take(Math.max(1, Math.min(200, filter?.limit ?? 50)));
    return qb.getMany();
  }
}
