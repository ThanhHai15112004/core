import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';

@Entity({ name: 'webhook_delivery_attempts' })
@Index('IDX_webhook_delivery_attempts_delivery_num', ['deliveryId', 'attemptNumber'])
@Index('IDX_webhook_delivery_attempts_endpoint_time', ['endpointId', 'attemptedAt'])
export class WebhookDeliveryAttemptEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'delivery_id', type: 'bigint' })
  public deliveryId!: number;

  @Column({ name: 'endpoint_id', type: 'bigint' })
  public endpointId!: number;

  @Column({ name: 'attempt_number', type: 'int', default: 1 })
  public attemptNumber!: number;

  @Column({ name: 'request_url', type: 'varchar', length: 1000 })
  public requestUrl!: string;

  @Column({ name: 'request_headers_json', type: 'text', nullable: true })
  public requestHeadersJson!: string | null;

  @Column({ name: 'response_status', type: 'int', nullable: true })
  public responseStatus!: number | null;

  @Column({ name: 'response_headers_json', type: 'text', nullable: true })
  public responseHeadersJson!: string | null;

  @Column({ name: 'response_body_snippet', type: 'text', nullable: true })
  public responseBodySnippet!: string | null;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  public durationMs!: number;

  @Column({ name: 'is_success', type: 'boolean', default: false })
  public isSuccess!: boolean;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  public errorCode!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'attempted_at', type: 'timestamp' })
  public attemptedAt!: Date;
}
