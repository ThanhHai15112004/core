import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';

@Entity({ name: 'inbound_webhook_attempts' })
@Index('IDX_inbound_webhook_attempts_event_num', ['eventId', 'attemptNumber'])
@Index('IDX_inbound_webhook_attempts_provider_time', ['providerCode', 'attemptedAt'])
export class InboundWebhookAttemptEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'event_id', type: 'bigint' })
  public eventId!: number;

  @Column({ name: 'provider_id', type: 'bigint' })
  public providerId!: number;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'attempt_number', type: 'int', default: 1 })
  public attemptNumber!: number;

  @Column({ name: 'handler_name', type: 'varchar', length: 160 })
  public handlerName!: string;

  @Column({ name: 'is_success', type: 'boolean', default: false })
  public isSuccess!: boolean;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  public durationMs!: number;

  @Column({ name: 'result_summary_json', type: 'text', nullable: true })
  public resultSummaryJson!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  public errorCode!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'attempted_at', type: 'timestamp' })
  public attemptedAt!: Date;
}
