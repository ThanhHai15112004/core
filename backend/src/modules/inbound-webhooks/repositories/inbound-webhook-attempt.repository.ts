import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { InboundWebhookAttemptEntity } from '../entities/inbound-webhook-attempt.entity.js';

@Injectable()
export class InboundWebhookAttemptRepository extends BaseTypeOrmRepository<InboundWebhookAttemptEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(InboundWebhookAttemptEntity, dataSource as DataSource, transactionManager);
  }

  public async findByEventId(eventId: number): Promise<InboundWebhookAttemptEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { eventId },
      order: { attemptedAt: 'ASC', id: 'ASC' },
    });
  }
}
