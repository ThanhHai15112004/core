import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { WebhookDeliveryAttemptEntity } from '../entities/webhook-delivery-attempt.entity.js';

@Injectable()
export class WebhookDeliveryAttemptRepository extends BaseTypeOrmRepository<WebhookDeliveryAttemptEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(WebhookDeliveryAttemptEntity, dataSource as DataSource, transactionManager);
  }

  public async findByDeliveryId(deliveryId: number): Promise<WebhookDeliveryAttemptEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { deliveryId },
      order: { attemptNumber: 'ASC', id: 'ASC' },
    });
  }
}
