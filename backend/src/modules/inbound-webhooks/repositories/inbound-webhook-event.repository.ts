import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { InboundWebhookEventStatusCode } from '../enum/inbound-webhooks.enum.js';
import { InboundWebhookEventEntity } from '../entities/inbound-webhook-event.entity.js';

export interface ListInboundWebhookEventsFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly providerCode?: string | undefined;
  readonly eventType?: string | undefined;
  readonly status?: InboundWebhookEventStatusCode | undefined;
  readonly search?: string | undefined;
}

@Injectable()
export class InboundWebhookEventRepository extends BaseTypeOrmRepository<InboundWebhookEventEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(InboundWebhookEventEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<InboundWebhookEventEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByProviderAndExternalEventId(
    providerCode: string,
    externalEventId: string,
  ): Promise<InboundWebhookEventEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        providerCode: providerCode.trim().toLowerCase(),
        externalEventId: externalEventId.trim(),
      },
    });
  }

  public async listPaginated(
    filter: ListInboundWebhookEventsFilter,
  ): Promise<PaginatedResult<InboundWebhookEventEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('event');

    if (filter.providerCode?.trim()) {
      qb.andWhere('event.providerCode = :providerCode', {
        providerCode: filter.providerCode.trim().toLowerCase(),
      });
    }

    if (filter.eventType?.trim()) {
      qb.andWhere('event.eventType = :eventType', {
        eventType: filter.eventType.trim(),
      });
    }

    if (filter.status !== undefined) {
      qb.andWhere('event.status = :status', { status: filter.status });
    }

    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'event.eventUid',
        'event.providerCode',
        'event.externalEventId',
        'event.eventType',
        'event.rejectionReason',
        'event.lastErrorCode',
        'event.lastErrorMessage',
      ]);
    }

    qb.orderBy('event.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
