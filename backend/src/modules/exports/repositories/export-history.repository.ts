import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { ExportHistoryEntity } from '../entities/export-history.entity.js';

@Injectable()
export class ExportHistoryRepository extends BaseTypeOrmRepository<ExportHistoryEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ExportHistoryEntity, dataSource as DataSource, transactionManager);
  }

  public override async findById(id: number): Promise<ExportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByToken(token: string): Promise<ExportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { downloadToken: token.trim() } });
  }

  public async findByJobId(jobId: string): Promise<ExportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { jobId: jobId.trim() } });
  }

  public async createRecord(
    payload: Partial<ExportHistoryEntity>,
  ): Promise<ExportHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.saveEntity(payload);
  }

  public async updateById(
    id: number,
    patch: Partial<ExportHistoryEntity>,
  ): Promise<ExportHistoryEntity | null> {
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

  public async markExpiredByNow(now: Date = new Date()): Promise<number> {
    if (!this.dataSource?.isInitialized) return 0;
    const res = await this.repository
      .createQueryBuilder()
      .update(ExportHistoryEntity)
      .set({
        isExpired: true,
        status: 'EXPIRED',
        downloadUrl: null,
        filePayloadBase64: null,
      })
      .where('is_expired = :isExpired', { isExpired: false })
      .andWhere('expires_at IS NOT NULL AND expires_at <= :now', { now })
      .execute();
    return res.affected ?? 0;
  }

  public async listFiltered(filter?: {
    readonly profileCode?: string | undefined;
    readonly module?: string | undefined;
    readonly actorId?: number | undefined;
    readonly format?: string | undefined;
    readonly status?: string | undefined;
    readonly includeExpired?: boolean | undefined;
    readonly limit?: number | undefined;
  }): Promise<ExportHistoryEntity[]> {
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
    if (filter?.format) {
      qb.andWhere('h.format = :format', { format: filter.format });
    }
    if (filter?.status) {
      qb.andWhere('h.status = :status', { status: filter.status });
    }
    if (filter?.includeExpired === false) {
      qb.andWhere('h.is_expired = :isExpired', { isExpired: false });
    }
    qb.take(Math.max(1, Math.min(200, filter?.limit ?? 50)));
    return qb.getMany();
  }
}
