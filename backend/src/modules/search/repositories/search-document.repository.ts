import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { SearchDocumentEntity } from '../entities/search-document.entity.js';

@Injectable()
export class SearchDocumentRepository extends BaseTypeOrmRepository<SearchDocumentEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(SearchDocumentEntity, dataSource as DataSource, transactionManager);
  }

  public async findByDocumentKey(documentKey: string): Promise<SearchDocumentEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { documentKey: documentKey.trim() } });
  }

  public async upsertDocument(
    payload: Partial<SearchDocumentEntity> & { readonly documentKey: string },
  ): Promise<SearchDocumentEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    const existing = await this.findByDocumentKey(payload.documentKey);
    return this.saveEntity({
      ...(existing ? { id: existing.id } : {}),
      ...payload,
    });
  }

  public async deleteByDocumentKey(documentKey: string): Promise<boolean> {
    if (!this.dataSource?.isInitialized) return false;
    const res = await this.repository.delete({ documentKey: documentKey.trim() });
    return (res.affected ?? 0) > 0;
  }

  public async deleteByEntityAndIds(
    entityCode: string,
    entityIds?: readonly (string | number)[],
  ): Promise<number> {
    if (!this.dataSource?.isInitialized) return 0;
    const normalizedCode = entityCode.trim().toLowerCase();
    const qb = this.repository
      .createQueryBuilder()
      .delete()
      .from(SearchDocumentEntity)
      .where('LOWER(entity_code) = :entityCode', { entityCode: normalizedCode });

    if (entityIds && entityIds.length > 0) {
      qb.andWhere('entity_id IN (:...entityIds)', {
        entityIds: entityIds.map((id) => String(id).trim()),
      });
    }

    const res = await qb.execute();
    return res.affected ?? 0;
  }

  public async deleteByFilter(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly entityCode?: string | undefined;
  }): Promise<number> {
    if (!this.dataSource?.isInitialized) return 0;
    const qb = this.repository.createQueryBuilder().delete().from(SearchDocumentEntity);
    if (filter?.module) {
      qb.andWhere('LOWER(module) = :module', { module: filter.module.trim().toLowerCase() });
    }
    if (filter?.entityType) {
      qb.andWhere('LOWER(entity_type) = :entityType', {
        entityType: filter.entityType.trim().toLowerCase(),
      });
    }
    if (filter?.entityCode) {
      qb.andWhere('LOWER(entity_code) = :entityCode', {
        entityCode: filter.entityCode.trim().toLowerCase(),
      });
    }
    const res = await qb.execute();
    return res.affected ?? 0;
  }
}
