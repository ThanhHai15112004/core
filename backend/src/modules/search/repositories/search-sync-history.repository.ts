import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { SearchSyncHistoryEntity } from '../entities/search-sync-history.entity.js';

@Injectable()
export class SearchSyncHistoryRepository extends BaseTypeOrmRepository<SearchSyncHistoryEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(SearchSyncHistoryEntity, dataSource as DataSource, transactionManager);
  }

  public override async findById(id: number): Promise<SearchSyncHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async createRecord(
    payload: Partial<SearchSyncHistoryEntity>,
  ): Promise<SearchSyncHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.saveEntity(payload);
  }

  public async updateById(
    id: number,
    patch: Partial<SearchSyncHistoryEntity>,
  ): Promise<SearchSyncHistoryEntity | null> {
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
    readonly operation?: 'SYNC' | 'REBUILD' | 'REMOVE' | undefined;
    readonly limit?: number | undefined;
  }): Promise<SearchSyncHistoryEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    const qb = this.repository.createQueryBuilder('h').orderBy('h.id', 'DESC');
    if (filter?.module) {
      qb.andWhere('LOWER(h.module) = LOWER(:module)', { module: filter.module.trim() });
    }
    if (filter?.operation) {
      qb.andWhere('h.operation = :operation', { operation: filter.operation });
    }
    qb.take(Math.max(1, Math.min(200, filter?.limit ?? 50)));
    return qb.getMany();
  }
}
