import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  WEBHOOK_DELIVERY_STATUS,
  WEBHOOK_TRIGGER_SOURCE,
  type WebhookDeliveryStatusCode,
  type WebhookTriggerSource,
} from '../enum/webhooks.enum.js';

@Entity({ name: 'webhook_deliveries' })
@Index('UQ_webhook_deliveries_uid', ['deliveryUid'], { unique: true })
@Index('IDX_webhook_deliveries_endpoint_status', ['endpointId', 'status', 'createdAt'])
@Index('IDX_webhook_deliveries_event_created', ['eventName', 'createdAt'])
@Index('IDX_webhook_deliveries_replayed_from', ['replayedFromDeliveryId'])
export class WebhookDeliveryEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'delivery_uid', type: 'varchar', length: 64 })
  public deliveryUid!: string;

  @Column({ name: 'endpoint_id', type: 'bigint' })
  public endpointId!: number;

  @Column({ name: 'event_name', type: 'varchar', length: 160 })
  public eventName!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 120 })
  public eventId!: string;

  @Column({ name: 'payload_json', type: 'text' })
  public payloadJson!: string;

  @Column({ type: 'smallint', default: WEBHOOK_DELIVERY_STATUS.PENDING })
  public status!: WebhookDeliveryStatusCode;

  @Column({
    name: 'trigger_source',
    type: 'varchar',
    length: 32,
    default: WEBHOOK_TRIGGER_SOURCE.EVENT,
  })
  public triggerSource!: WebhookTriggerSource;

  @Column({ name: 'replayed_from_delivery_id', type: 'bigint', nullable: true })
  public replayedFromDeliveryId!: number | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  public attemptCount!: number;

  @Column({ name: 'max_attempts', type: 'int', default: 6 })
  public maxAttempts!: number;

  @Column({ name: 'last_http_status', type: 'int', nullable: true })
  public lastHttpStatus!: number | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 80, nullable: true })
  public lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'varchar', length: 1000, nullable: true })
  public lastErrorMessage!: string | null;

  @Column({ name: 'next_retry_at', type: 'timestamp', nullable: true })
  public nextRetryAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  public deliveredAt!: Date | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 120, nullable: true })
  public correlationId!: string | null;

  @Column({ name: 'requested_by', type: 'bigint', nullable: true })
  public requestedBy!: number | null;
}
