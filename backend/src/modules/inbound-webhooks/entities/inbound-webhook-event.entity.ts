import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  INBOUND_WEBHOOK_EVENT_STATUS,
  type InboundWebhookEventStatusCode,
} from '../enum/inbound-webhooks.enum.js';

@Entity({ name: 'inbound_webhook_events' })
@Index('UQ_inbound_webhook_events_uid', ['eventUid'], { unique: true })
@Index('UQ_inbound_webhook_events_idempotency', ['providerCode', 'externalEventId'], {
  unique: true,
})
@Index('IDX_inbound_webhook_events_provider_status', ['providerCode', 'status', 'createdAt'])
@Index('IDX_inbound_webhook_events_type_created', ['eventType', 'createdAt'])
@Index('IDX_inbound_webhook_events_received', ['receivedAt'])
export class InboundWebhookEventEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'event_uid', type: 'varchar', length: 64 })
  public eventUid!: string;

  @Column({ name: 'provider_id', type: 'bigint' })
  public providerId!: number;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  /** Luôn NULL với bản ghi REJECTED để tránh kẻ tấn công làm nhiễm khóa idempotency */
  @Column({ name: 'external_event_id', type: 'varchar', length: 160, nullable: true })
  public externalEventId!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 160, nullable: true })
  public eventType!: string | null;

  @Column({ name: 'event_timestamp', type: 'timestamp', nullable: true })
  public eventTimestamp!: Date | null;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64 })
  public payloadHash!: string;

  @Column({ name: 'headers_redacted_json', type: 'text', nullable: true })
  public headersRedactedJson!: string | null;

  @Column({ name: 'payload_redacted_json', type: 'text', nullable: true })
  public payloadRedactedJson!: string | null;

  @Column({ name: 'payload_size_bytes', type: 'int', default: 0 })
  public payloadSizeBytes!: number;

  @Column({ name: 'payload_truncated', type: 'boolean', default: false })
  public payloadTruncated!: boolean;

  @Column({ name: 'source_ip_masked', type: 'varchar', length: 64, nullable: true })
  public sourceIpMasked!: string | null;

  @Column({ type: 'smallint', default: INBOUND_WEBHOOK_EVENT_STATUS.QUEUED })
  public status!: InboundWebhookEventStatusCode;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 80, nullable: true })
  public rejectionReason!: string | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  public attemptCount!: number;

  @Column({ name: 'max_attempts', type: 'int', default: 4 })
  public maxAttempts!: number;

  @Column({ name: 'duplicate_count', type: 'int', default: 0 })
  public duplicateCount!: number;

  @Column({ name: 'last_duplicate_at', type: 'timestamp', nullable: true })
  public lastDuplicateAt!: Date | null;

  @Column({ name: 'last_handler_name', type: 'varchar', length: 160, nullable: true })
  public lastHandlerName!: string | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 80, nullable: true })
  public lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'varchar', length: 1000, nullable: true })
  public lastErrorMessage!: string | null;

  @Column({ name: 'received_at', type: 'timestamp' })
  public receivedAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  public processedAt!: Date | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 120, nullable: true })
  public correlationId!: string | null;
}
