import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  WEBHOOK_DEFAULTS,
  WEBHOOK_ENDPOINT_STATUS,
  type WebhookEndpointStatusCode,
} from '../enum/webhooks.enum.js';

@Entity({ name: 'webhook_endpoints' })
@Index('IDX_webhook_endpoints_status', ['status', 'deletedAt'])
@Index('IDX_webhook_endpoints_created', ['createdAt'])
export class WebhookEndpointEntity extends VersionedTypeOrmEntity {
  @Column({ type: 'varchar', length: 180 })
  public name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'target_url', type: 'varchar', length: 1000 })
  public targetUrl!: string;

  @Column({ name: 'events_json', type: 'text' })
  public eventsJson!: string;

  @Column({ type: 'smallint', default: WEBHOOK_ENDPOINT_STATUS.ACTIVE })
  public status!: WebhookEndpointStatusCode;

  @Column({ name: 'signing_secret_encrypted', type: 'text' })
  public signingSecretEncrypted!: string;

  @Column({ name: 'signing_secret_prefix', type: 'varchar', length: 32 })
  public signingSecretPrefix!: string;

  @Column({ name: 'custom_headers_json', type: 'text', nullable: true })
  public customHeadersJson!: string | null;

  @Column({ name: 'timeout_ms', type: 'int', default: WEBHOOK_DEFAULTS.TIMEOUT_MS })
  public timeoutMs!: number;

  @Column({ name: 'max_retries', type: 'smallint', default: WEBHOOK_DEFAULTS.MAX_RETRIES })
  public maxRetries!: number;

  @Column({
    name: 'failure_threshold',
    type: 'smallint',
    default: WEBHOOK_DEFAULTS.FAILURE_THRESHOLD,
  })
  public failureThreshold!: number;

  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  public consecutiveFailures!: number;

  @Column({ name: 'disabled_reason', type: 'varchar', length: 500, nullable: true })
  public disabledReason!: string | null;

  @Column({ name: 'disabled_at', type: 'timestamp', nullable: true })
  public disabledAt!: Date | null;

  @Column({ name: 'last_triggered_at', type: 'timestamp', nullable: true })
  public lastTriggeredAt!: Date | null;

  @Column({ name: 'last_success_at', type: 'timestamp', nullable: true })
  public lastSuccessAt!: Date | null;

  @Column({ name: 'last_failure_at', type: 'timestamp', nullable: true })
  public lastFailureAt!: Date | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
