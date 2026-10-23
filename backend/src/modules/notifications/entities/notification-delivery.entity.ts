import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_ERROR_TYPE,
} from '../enum/notifications.enum.js';

@Entity('notification_deliveries')
@Index('uq_notification_deliveries_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('idx_notification_deliveries_notification_id', ['notificationId'])
@Index('idx_notification_deliveries_recipient_user_id', ['recipientUserId'])
@Index('idx_notification_deliveries_status_retry', ['status', 'nextRetryAt'])
@Index('idx_notification_deliveries_batch_key', ['batchKey'])
@Index('idx_notification_deliveries_destination', ['channel', 'destination'])
export class NotificationDeliveryEntity extends TypeOrmBaseEntity {
  @Column({ name: 'notification_id', type: 'int' })
  public notificationId!: number;

  @Column({ name: 'recipient_id', type: 'int', nullable: true })
  public recipientId?: number | null;

  @Column({ name: 'recipient_user_id', type: 'int' })
  public recipientUserId!: number;

  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  @Column({ type: 'int', default: NOTIFICATION_CHANNEL.EMAIL })
  public channel!: number;

  @Column({ name: 'provider_code', type: 'varchar', length: 64, default: 'CONSOLE' })
  public providerCode!: string;

  @Column({ type: 'varchar', length: 320 })
  public destination!: string;

  @Column({ name: 'template_code', type: 'varchar', length: 100, nullable: true })
  public templateCode?: string | null;

  @Column({ name: 'rendered_subject', type: 'varchar', length: 500, nullable: true })
  public renderedSubject?: string | null;

  @Column({ name: 'rendered_body', type: 'text' })
  public renderedBody!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  public idempotencyKey!: string;

  @Column({ name: 'batch_key', type: 'varchar', length: 64, nullable: true })
  public batchKey?: string | null;

  @Column({ type: 'int', default: NOTIFICATION_DELIVERY_STATUS.QUEUED })
  public status!: number;

  @Column({ name: 'error_type', type: 'int', default: NOTIFICATION_ERROR_TYPE.NONE })
  public errorType!: number;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  public errorCode?: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true })
  public errorMessage?: string | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  public attemptCount!: number;

  @Column({ name: 'max_attempts', type: 'int', default: 3 })
  public maxAttempts!: number;

  @Column({ name: 'next_retry_at', type: 'timestamp', nullable: true })
  public nextRetryAt?: Date | null;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 128, nullable: true })
  public providerMessageId?: string | null;

  @Column({ name: 'segments_count', type: 'int', default: 1 })
  public segmentsCount!: number;

  @Column({ name: 'estimated_cost', type: 'decimal', precision: 12, scale: 4, default: '0.0000' })
  public estimatedCost!: string | number;

  @Column({ type: 'varchar', length: 16, default: 'VND' })
  public currency!: string;

  @Column({ name: 'queued_at', type: 'timestamp' })
  public queuedAt!: Date;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  public sentAt?: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  public deliveredAt?: Date | null;

  @Column({ name: 'failed_at', type: 'timestamp', nullable: true })
  public failedAt?: Date | null;
}
