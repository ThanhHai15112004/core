import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  OUTBOX_DEFAULTS,
  OUTBOX_EVENT_STATUS,
  type OutboxEventStatusCode,
} from '../enum/outbox.enum.js';

@Entity({ name: 'outbox_events' })
@Index('UQ_outbox_events_event_id', ['eventId'], { unique: true })
@Index('IDX_outbox_events_dispatch', ['status', 'nextAttemptAt', 'id'])
@Index('IDX_outbox_events_lease', ['status', 'lockedUntil'])
@Index('IDX_outbox_events_source_type', ['sourceModule', 'eventType', 'createdAt'])
@Index('IDX_outbox_events_correlation', ['correlationId'])
@Index('IDX_outbox_events_published_at', ['status', 'publishedAt'])
@Index('IDX_outbox_events_dead_lettered_at', ['status', 'deadLetteredAt'])
export class OutboxEventEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'event_id', type: 'varchar', length: 120 })
  public eventId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 160 })
  public eventType!: string;

  @Column({ name: 'dot_name', type: 'varchar', length: 160 })
  public dotName!: string;

  @Column({ name: 'event_version', type: 'int', default: 1 })
  public eventVersion!: number;

  @Column({ name: 'source_module', type: 'varchar', length: 80 })
  public sourceModule!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 120, nullable: true })
  public aggregateType!: string | null;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 160, nullable: true })
  public aggregateId!: string | null;

  @Column({ name: 'partition_key', type: 'varchar', length: 200, nullable: true })
  public partitionKey!: string | null;

  @Column({
    name: 'destination_queue',
    type: 'varchar',
    length: 120,
    default: OUTBOX_DEFAULTS.DESTINATION_QUEUE,
  })
  public destinationQueue!: string;

  @Column({
    name: 'destination_topic',
    type: 'varchar',
    length: 160,
    default: OUTBOX_DEFAULTS.DESTINATION_TOPIC,
  })
  public destinationTopic!: string;

  @Column({ name: 'payload_json', type: 'text' })
  public payloadJson!: string;

  @Column({ name: 'metadata_json', type: 'text' })
  public metadataJson!: string;

  @Column({ name: 'headers_json', type: 'text', nullable: true })
  public headersJson!: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 120, nullable: true })
  public requestId!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 120, nullable: true })
  public correlationId!: string | null;

  @Column({ name: 'causation_id', type: 'varchar', length: 120, nullable: true })
  public causationId!: string | null;

  @Column({ name: 'actor_id', type: 'varchar', length: 120, nullable: true })
  public actorId!: string | null;

  @Column({ name: 'occurred_at', type: 'timestamp' })
  public occurredAt!: Date;

  @Column({ type: 'smallint', default: OUTBOX_EVENT_STATUS.PENDING })
  public status!: OutboxEventStatusCode;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  public attemptCount!: number;

  @Column({ name: 'max_retries', type: 'int', default: OUTBOX_DEFAULTS.MAX_RETRIES })
  public maxRetries!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamp', nullable: true })
  public nextAttemptAt!: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 160, nullable: true })
  public lockedBy!: string | null;

  @Column({ name: 'locked_until', type: 'timestamp', nullable: true })
  public lockedUntil!: Date | null;

  @Column({ name: 'last_attempted_at', type: 'timestamp', nullable: true })
  public lastAttemptedAt!: Date | null;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  public publishedAt!: Date | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 80, nullable: true })
  public lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'varchar', length: 1000, nullable: true })
  public lastErrorMessage!: string | null;

  @Column({ name: 'dead_lettered_at', type: 'timestamp', nullable: true })
  public deadLetteredAt!: Date | null;

  @Column({ name: 'dead_letter_reason', type: 'varchar', length: 500, nullable: true })
  public deadLetterReason!: string | null;

  @Column({ name: 'replay_count', type: 'int', default: 0 })
  public replayCount!: number;

  @Column({ name: 'last_replayed_at', type: 'timestamp', nullable: true })
  public lastReplayedAt!: Date | null;

  @Column({ name: 'last_replayed_by', type: 'bigint', nullable: true })
  public lastReplayedBy!: number | null;
}
