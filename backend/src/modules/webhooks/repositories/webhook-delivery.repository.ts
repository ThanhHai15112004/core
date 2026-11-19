import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { WebhookDeliveryStatusCode, WebhookTriggerSource } from '../enum/webhooks.enum.js';
import { WebhookDeliveryEntity } from '../entities/webhook-delivery.entity.js';

export interface ListWebhookDeliveriesFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly endpointId?: number | undefined;
  readonly eventName?: string | undefined;
  readonly status?: WebhookDeliveryStatusCode | undefined;
  readonly triggerSource?: WebhookTriggerSource | undefined;
  readonly search?: string | undefined;
}

@Injectable()
export class WebhookDeliveryRepository extends BaseTypeOrmRepository<WebhookDeliveryEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(WebhookDeliveryEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdSafe(id: number): Promise<WebhookDeliveryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async listPaginated(
    filter: ListWebhookDeliveriesFilter,
  ): Promise<PaginatedResult<WebhookDeliveryEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('delivery');

    if (filter.endpointId !== undefined) {
      qb.andWhere('delivery.endpointId = :endpointId', { endpointId: filter.endpointId });
    }

    if (filter.eventName?.trim()) {
      qb.andWhere('delivery.eventName = :eventName', {
        eventName: filter.eventName.trim().toLowerCase(),
      });
    }

    if (filter.status !== undefined) {
      qb.andWhere('delivery.status = :status', { status: filter.status });
    }

    if (filter.triggerSource !== undefined) {
      qb.andWhere('delivery.triggerSource = :triggerSource', {
        triggerSource: filter.triggerSource,
      });
    }

    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'delivery.deliveryUid',
        'delivery.eventName',
        'delivery.eventId',
        'delivery.lastErrorCode',
        'delivery.lastErrorMessage',
      ]);
    }

    qb.orderBy('delivery.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
