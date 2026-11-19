import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  PAYMENT_REFUND_STATUS,
  type PaymentRefundStatusCode,
  type PaymentRefundType,
} from '../enum/payments.enum.js';
import {
  bigintNumberTransformer,
  nullableBigintNumberTransformer,
} from '../helpers/payment-bigint.helper.js';

@Entity({ name: 'payment_refunds' })
@Index('UQ_pay_refunds_code', ['refundCode'], { unique: true })
@Index('UQ_pay_refunds_idempotency', ['idempotencyKey'], { unique: true })
@Index('IDX_pay_refunds_tx', ['paymentTransactionId', 'status'])
export class PaymentRefundEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'refund_code', type: 'varchar', length: 64 })
  public refundCode!: string;

  @Column({
    name: 'payment_transaction_id',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  public paymentTransactionId!: number;

  @Column({ name: 'payment_code', type: 'varchar', length: 64 })
  public paymentCode!: string;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  public idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'varchar', length: 64 })
  public requestFingerprint!: string;

  @Column({ name: 'refund_type', type: 'varchar', length: 16 })
  public refundType!: PaymentRefundType;

  @Column({ type: 'bigint', transformer: bigintNumberTransformer })
  public amount!: number;

  @Column({ type: 'varchar', length: 8 })
  public currency!: string;

  @Column({ type: 'smallint', default: PAYMENT_REFUND_STATUS.PENDING })
  public status!: PaymentRefundStatusCode;

  @Column({ name: 'provider_refund_id', type: 'varchar', length: 180, nullable: true })
  public providerRefundId!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public reason!: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;

  @Column({ name: 'provider_raw_response_redacted_json', type: 'text', nullable: true })
  public providerRawResponseRedactedJson!: string | null;

  @Column({ name: 'refunded_at', type: 'timestamp', nullable: true })
  public refundedAt!: Date | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 80, nullable: true })
  public failureCode!: string | null;

  @Column({ name: 'failure_message', type: 'varchar', length: 500, nullable: true })
  public failureMessage!: string | null;

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public createdBy!: number | null;
}
