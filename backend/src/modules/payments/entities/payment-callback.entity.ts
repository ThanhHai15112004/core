import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type {
  PaymentCallbackStatusCode,
  PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';
import { nullableBigintNumberTransformer } from '../helpers/payment-bigint.helper.js';

@Entity({ name: 'payment_callbacks' })
@Index('UQ_pay_callbacks_uid', ['callbackUid'], { unique: true })
@Index('IDX_pay_callbacks_provider_event', ['providerCode', 'providerEventId'])
@Index('IDX_pay_callbacks_tx_time', ['paymentTransactionId', 'createdAt'])
@Index('IDX_pay_callbacks_provider_status_time', [
  'providerCode',
  'verificationStatus',
  'createdAt',
])
export class PaymentCallbackEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'callback_uid', type: 'varchar', length: 64 })
  public callbackUid!: string;

  @Column({
    name: 'provider_id',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public providerId!: number | null;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({
    name: 'payment_transaction_id',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public paymentTransactionId!: number | null;

  @Column({ name: 'payment_code', type: 'varchar', length: 64, nullable: true })
  public paymentCode!: string | null;

  @Column({ name: 'provider_event_id', type: 'varchar', length: 180, nullable: true })
  public providerEventId!: string | null;

  @Column({ name: 'provider_transaction_id', type: 'varchar', length: 180, nullable: true })
  public providerTransactionId!: string | null;

  @Column({ name: 'http_method', type: 'varchar', length: 10 })
  public httpMethod!: string;

  @Column({ name: 'verification_status', type: 'smallint' })
  public verificationStatus!: PaymentCallbackStatusCode;

  @Column({ name: 'signature_valid', type: 'boolean', default: false })
  public signatureValid!: boolean;

  @Column({ name: 'reported_status', type: 'smallint', nullable: true })
  public reportedStatus!: PaymentTransactionStatusCode | null;

  @Column({
    name: 'reported_amount',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public reportedAmount!: number | null;

  @Column({ name: 'reported_currency', type: 'varchar', length: 8, nullable: true })
  public reportedCurrency!: string | null;

  @Column({ name: 'payload_sha256', type: 'varchar', length: 64 })
  public payloadSha256!: string;

  @Column({ name: 'headers_redacted_json', type: 'text', nullable: true })
  public headersRedactedJson!: string | null;

  @Column({ name: 'payload_redacted_json', type: 'text', nullable: true })
  public payloadRedactedJson!: string | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 255, nullable: true })
  public rejectionReason!: string | null;

  @Column({ name: 'source_ip_masked', type: 'varchar', length: 64, nullable: true })
  public sourceIpMasked!: string | null;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  public processedAt!: Date | null;
}
