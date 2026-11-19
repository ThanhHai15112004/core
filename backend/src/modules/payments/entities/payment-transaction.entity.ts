import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  PAYMENT_TRANSACTION_STATUS,
  type PaymentDriverCode,
  type PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';
import {
  bigintNumberTransformer,
  nullableBigintNumberTransformer,
} from '../helpers/payment-bigint.helper.js';

@Entity({ name: 'payment_transactions' })
@Index('UQ_pay_tx_code', ['paymentCode'], { unique: true })
@Index('UQ_pay_tx_idempotency', ['idempotencyKey'], { unique: true })
@Index('IDX_pay_tx_provider_status_time', ['providerCode', 'status', 'createdAt'])
@Index('IDX_pay_tx_merchant_ref', ['merchantOrderRef', 'providerCode'])
@Index('IDX_pay_tx_provider_tx_id', ['providerCode', 'providerTransactionId'])
export class PaymentTransactionEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'payment_code', type: 'varchar', length: 64 })
  public paymentCode!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  public idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'varchar', length: 64 })
  public requestFingerprint!: string;

  @Column({ name: 'provider_id', type: 'bigint', transformer: bigintNumberTransformer })
  public providerId!: number;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'driver_code', type: 'varchar', length: 32 })
  public driverCode!: PaymentDriverCode;

  @Column({ name: 'provider_transaction_id', type: 'varchar', length: 180, nullable: true })
  public providerTransactionId!: string | null;

  @Column({ name: 'merchant_order_ref', type: 'varchar', length: 128 })
  public merchantOrderRef!: string;

  @Column({ type: 'bigint', transformer: bigintNumberTransformer })
  public amount!: number;

  @Column({
    name: 'refunded_amount',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  public refundedAmount!: number;

  @Column({ type: 'varchar', length: 8 })
  public currency!: string;

  @Column({ type: 'smallint', default: PAYMENT_TRANSACTION_STATUS.PENDING })
  public status!: PaymentTransactionStatusCode;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'checkout_url', type: 'varchar', length: 2000, nullable: true })
  public checkoutUrl!: string | null;

  @Column({ name: 'qr_payload', type: 'text', nullable: true })
  public qrPayload!: string | null;

  @Column({ name: 'return_url', type: 'varchar', length: 1000, nullable: true })
  public returnUrl!: string | null;

  @Column({ name: 'cancel_url', type: 'varchar', length: 1000, nullable: true })
  public cancelUrl!: string | null;

  @Column({ name: 'customer_json', type: 'text', nullable: true })
  public customerJson!: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;

  @Column({ name: 'provider_raw_response_redacted_json', type: 'text', nullable: true })
  public providerRawResponseRedactedJson!: string | null;

  @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
  public paidAt!: Date | null;

  @Column({ name: 'expired_at', type: 'timestamp', nullable: true })
  public expiredAt!: Date | null;

  @Column({ name: 'last_callback_at', type: 'timestamp', nullable: true })
  public lastCallbackAt!: Date | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 80, nullable: true })
  public failureCode!: string | null;

  @Column({ name: 'failure_message', type: 'varchar', length: 500, nullable: true })
  public failureMessage!: string | null;

  @Column({
    name: 'organization_unit_id',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public organizationUnitId!: number | null;

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public createdBy!: number | null;
}
