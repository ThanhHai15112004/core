import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ScimUserLinkEntity } from '../entities/scim-user-link.entity.js';

export interface ListScimUserLinksFilter {
  readonly clientId?: number | undefined;
  readonly active?: boolean | undefined;
  readonly search?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

@Injectable()
export class ScimUserLinkRepository extends BaseTypeOrmRepository<ScimUserLinkEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ScimUserLinkEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<ScimUserLinkEntity>): ScimUserLinkEntity {
    return this.repository.create(data);
  }

  public async findByClientAndExternalId(
    clientId: number,
    externalId: string,
  ): Promise<ScimUserLinkEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { clientId, externalId: externalId.trim() },
    });
  }

  public async findByClientAndUserId(
    clientId: number,
    userId: number,
  ): Promise<ScimUserLinkEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { clientId, userId },
    });
  }

  public async findByClient(clientId: number): Promise<ScimUserLinkEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { clientId },
      order: { id: 'ASC' },
    });
  }

  public async listPaginated(
    filter: ListScimUserLinksFilter,
  ): Promise<PaginatedResult<ScimUserLinkEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('link');

    if (filter.clientId !== undefined) {
      qb.andWhere('link.clientId = :clientId', { clientId: filter.clientId });
    }
    if (filter.active !== undefined) {
      qb.andWhere('link.active = :active', { active: filter.active });
    }
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim().toLowerCase()}%`;
      qb.andWhere('(LOWER(link.externalId) LIKE :term OR LOWER(link.scimUsername) LIKE :term)', {
        term,
      });
    }

    qb.orderBy('link.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
