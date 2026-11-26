import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ScimGroupEntity } from '../entities/scim-group.entity.js';

export interface ListScimGroupsFilter {
  readonly clientId?: number | undefined;
  readonly search?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

@Injectable()
export class ScimGroupRepository extends BaseTypeOrmRepository<ScimGroupEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ScimGroupEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<ScimGroupEntity>): ScimGroupEntity {
    return this.repository.create(data);
  }

  public async softDeleteEntity(entity: ScimGroupEntity): Promise<ScimGroupEntity> {
    return this.repository.softRemove(entity);
  }

  public async findByClientAndId(
    clientId: number,
    groupId: number,
  ): Promise<ScimGroupEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { id: groupId, clientId },
    });
  }

  public async findByClientAndExternalId(
    clientId: number,
    externalId: string,
  ): Promise<ScimGroupEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { clientId, externalId: externalId.trim() },
    });
  }

  public async findByClientAndDisplayName(
    clientId: number,
    displayName: string,
  ): Promise<ScimGroupEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { clientId, displayName: displayName.trim() },
    });
  }

  public async findByClient(clientId: number): Promise<ScimGroupEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { clientId },
      order: { id: 'ASC' },
    });
  }

  public async listPaginated(
    filter: ListScimGroupsFilter,
  ): Promise<PaginatedResult<ScimGroupEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('grp');

    if (filter.clientId !== undefined) {
      qb.andWhere('grp.clientId = :clientId', { clientId: filter.clientId });
    }
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(grp.displayName) LIKE :term OR LOWER(COALESCE(grp.externalId, \'\')) LIKE :term)',
        { term },
      );
    }

    qb.orderBy('grp.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
