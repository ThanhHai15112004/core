import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { SearchZeroResultKeywordEntity } from '../entities/search-zero-result-keyword.entity.js';

@Injectable()
export class SearchZeroResultKeywordRepository extends BaseTypeOrmRepository<SearchZeroResultKeywordEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(SearchZeroResultKeywordEntity, dataSource as DataSource, transactionManager);
  }

  public async findByKeywordKey(keywordKey: string): Promise<SearchZeroResultKeywordEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { keywordKey } });
  }

  public override async findById(id: number): Promise<SearchZeroResultKeywordEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async upsertKeywordStat(
    payload: Partial<SearchZeroResultKeywordEntity> & { readonly keywordKey: string },
  ): Promise<SearchZeroResultKeywordEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    const existing = await this.findByKeywordKey(payload.keywordKey);
    return this.saveEntity({
      ...(existing ? { id: existing.id } : {}),
      ...payload,
    });
  }

  public async deleteByIdOrKeyword(idOrKeyword: number | string): Promise<boolean> {
    if (!this.dataSource?.isInitialized) return false;
    const asNum = Number(idOrKeyword);
    if (Number.isInteger(asNum) && asNum > 0) {
      const res = await this.repository.delete({ id: asNum });
      if ((res.affected ?? 0) > 0) return true;
    }
    const clean = String(idOrKeyword).trim().toLowerCase();
    const res = await this.repository
      .createQueryBuilder()
      .delete()
      .from(SearchZeroResultKeywordEntity)
      .where('LOWER(normalized_keyword) = :clean OR LOWER(keyword_key) = :clean', { clean })
      .execute();
    return (res.affected ?? 0) > 0;
  }

  public async listFiltered(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<SearchZeroResultKeywordEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    const qb = this.repository.createQueryBuilder('k').orderBy('k.search_count', 'DESC');
    if (filter?.module) {
      qb.andWhere('LOWER(k.module) = LOWER(:module)', { module: filter.module.trim() });
    }
    if (filter?.entityType) {
      qb.andWhere('LOWER(k.entity_type) = LOWER(:entityType)', {
        entityType: filter.entityType.trim(),
      });
    }
    qb.take(Math.max(1, Math.min(200, filter?.limit ?? 20)));
    return qb.getMany();
  }
}
