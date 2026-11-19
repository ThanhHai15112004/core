import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { FederatedAuthEventEntity } from '../entities/federated-auth-event.entity.js';

export interface ListFederatedAuthEventsFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly providerCode?: string | undefined;
  readonly stage?: string | undefined;
  readonly outcome?: string | undefined;
  readonly errorCode?: string | undefined;
}

@Injectable()
export class FederatedAuthEventRepository extends BaseTypeOrmRepository<FederatedAuthEventEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(FederatedAuthEventEntity, dataSource as DataSource, transactionManager);
  }

  public async listPaginated(
    filter: ListFederatedAuthEventsFilter,
  ): Promise<PaginatedResult<FederatedAuthEventEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('event');

    if (filter.providerCode?.trim()) {
      qb.andWhere('event.providerCode = :providerCode', {
        providerCode: filter.providerCode.trim().toLowerCase(),
      });
    }

    if (filter.stage?.trim()) {
      qb.andWhere('event.stage = :stage', {
        stage: filter.stage.trim().toUpperCase(),
      });
    }

    if (filter.outcome?.trim()) {
      qb.andWhere('event.outcome = :outcome', {
        outcome: filter.outcome.trim().toUpperCase(),
      });
    }

    if (filter.errorCode?.trim()) {
      qb.andWhere('event.errorCode = :errorCode', {
        errorCode: filter.errorCode.trim(),
      });
    }

    qb.orderBy('event.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }

  public async findEventsSince(
    since: Date,
    providerCode?: string,
  ): Promise<FederatedAuthEventEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    const qb = this.repository
      .createQueryBuilder('event')
      .where('event.occurredAt >= :since', { since });

    if (providerCode?.trim()) {
      qb.andWhere('event.providerCode = :providerCode', {
        providerCode: providerCode.trim().toLowerCase(),
      });
    }

    qb.orderBy('event.occurredAt', 'DESC');
    return qb.getMany();
  }
}
