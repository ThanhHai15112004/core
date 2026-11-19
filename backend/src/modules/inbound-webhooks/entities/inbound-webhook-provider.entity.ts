import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  INBOUND_WEBHOOK_AUTH_TYPE,
  INBOUND_WEBHOOK_DEFAULTS,
  INBOUND_WEBHOOK_PROVIDER_STATUS,
  INBOUND_WEBHOOK_SIGNATURE_FORMAT,
  type InboundWebhookAuthType,
  type InboundWebhookProviderStatusCode,
  type InboundWebhookSignatureFormat,
} from '../enum/inbound-webhooks.enum.js';

@Entity({ name: 'inbound_webhook_providers' })
@Index('UQ_inbound_webhook_providers_code', ['providerCode'], { unique: true })
@Index('IDX_inbound_webhook_providers_status', ['status', 'deletedAt'])
export class InboundWebhookProviderEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ type: 'varchar', length: 180 })
  public name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ type: 'smallint', default: INBOUND_WEBHOOK_PROVIDER_STATUS.ACTIVE })
  public status!: InboundWebhookProviderStatusCode;

  @Column({
    name: 'auth_type',
    type: 'varchar',
    length: 32,
    default: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
  })
  public authType!: InboundWebhookAuthType;

  @Column({ name: 'signing_secret_encrypted', type: 'text' })
  public signingSecretEncrypted!: string;

  @Column({ name: 'signing_secret_prefix', type: 'varchar', length: 32 })
  public signingSecretPrefix!: string;

  @Column({
    name: 'signature_header',
    type: 'varchar',
    length: 120,
    default: INBOUND_WEBHOOK_DEFAULTS.SIGNATURE_HEADER,
  })
  public signatureHeader!: string;

  @Column({
    name: 'signature_prefix',
    type: 'varchar',
    length: 32,
    nullable: true,
    default: INBOUND_WEBHOOK_DEFAULTS.SIGNATURE_PREFIX,
  })
  public signaturePrefix!: string | null;

  @Column({
    name: 'signature_format',
    type: 'varchar',
    length: 32,
    default: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
  })
  public signatureFormat!: InboundWebhookSignatureFormat;

  @Column({
    name: 'timestamp_header',
    type: 'varchar',
    length: 120,
    default: INBOUND_WEBHOOK_DEFAULTS.TIMESTAMP_HEADER,
  })
  public timestampHeader!: string;

  @Column({ name: 'require_timestamp', type: 'boolean', default: true })
  public requireTimestamp!: boolean;

  @Column({
    name: 'tolerance_sec',
    type: 'int',
    default: INBOUND_WEBHOOK_DEFAULTS.TOLERANCE_SEC,
  })
  public toleranceSec!: number;

  @Column({
    name: 'event_id_header',
    type: 'varchar',
    length: 120,
    default: INBOUND_WEBHOOK_DEFAULTS.EVENT_ID_HEADER,
  })
  public eventIdHeader!: string;

  @Column({
    name: 'event_id_payload_path',
    type: 'varchar',
    length: 160,
    nullable: true,
    default: INBOUND_WEBHOOK_DEFAULTS.EVENT_ID_PAYLOAD_PATH,
  })
  public eventIdPayloadPath!: string | null;

  @Column({
    name: 'event_type_header',
    type: 'varchar',
    length: 120,
    default: INBOUND_WEBHOOK_DEFAULTS.EVENT_TYPE_HEADER,
  })
  public eventTypeHeader!: string;

  @Column({
    name: 'event_type_payload_path',
    type: 'varchar',
    length: 160,
    nullable: true,
    default: INBOUND_WEBHOOK_DEFAULTS.EVENT_TYPE_PAYLOAD_PATH,
  })
  public eventTypePayloadPath!: string | null;

  @Column({ name: 'sensitive_fields_json', type: 'text', nullable: true })
  public sensitiveFieldsJson!: string | null;

  @Column({ name: 'max_retries', type: 'smallint', default: INBOUND_WEBHOOK_DEFAULTS.MAX_RETRIES })
  public maxRetries!: number;

  @Column({ name: 'last_received_at', type: 'timestamp', nullable: true })
  public lastReceivedAt!: Date | null;

  @Column({ name: 'last_processed_at', type: 'timestamp', nullable: true })
  public lastProcessedAt!: Date | null;

  @Column({ name: 'last_rejected_at', type: 'timestamp', nullable: true })
  public lastRejectedAt!: Date | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
