import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  PAYMENT_RECONCILIATION_RESOLUTION,
  type PaymentReconciliationDiscrepancyCode,
  type PaymentReconciliationResolutionCode,
  type PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';
import {
  bigintNumberTransformer,
  nullableBigintNumberTransformer,
} from '../helpers/payment-bigint.helper.js';

@Entity({ name: 'payment_reconciliation_items' })
@Index('IDX_pay_recon_items_run_status', [
  'reconciliationId',
  'discrepancyStatus',
  'resolutionStatus',
])
@Index('IDX_pay_recon_items_tx', ['paymentTransactionId'])
export class PaymentReconciliationItemEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'reconciliation_id', type: 'bigint', transformer: bigintNumberTransformer })
  public reconciliationId!: number;

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

  @Column({ name: 'merchant_order_ref', type: 'varchar', length: 128, nullable: true })
  public merchantOrderRef!: string | null;

  @Column({ name: 'provider_transaction_id', type: 'varchar', length: 180, nullable: true })
  public providerTransactionId!: string | null;

  @Column({ name: 'discrepancy_status', type: 'smallint' })
  public discrepancyStatus!: PaymentReconciliationDiscrepancyCode;

  @Column({
    name: 'resolution_status',
    type: 'smallint',
    default: PAYMENT_RECONCILIATION_RESOLUTION.OPEN,
  })
  public resolutionStatus!: PaymentReconciliationResolutionCode;

  @Column({ name: 'internal_status', type: 'smallint', nullable: true })
  public internalStatus!: PaymentTransactionStatusCode | null;

  @Column({ name: 'provider_status', type: 'smallint', nullable: true })
  public providerStatus!: PaymentTransactionStatusCode | null;

  @Column({
    name: 'internal_amount',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public internalAmount!: number | null;

  @Column({
    name: 'provider_amount',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public providerAmount!: number | null;

  @Column({
    name: 'internal_refunded_amount',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public internalRefundedAmount!: number | null;

  @Column({
    name: 'provider_refunded_amount',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public providerRefundedAmount!: number | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  public currency!: string | null;

  @Column({ name: 'diff_details_json', type: 'text', nullable: true })
  public diffDetailsJson!: string | null;

  @Column({ name: 'resolution_note', type: 'varchar', length: 500, nullable: true })
  public resolutionNote!: string | null;

  @Column({
    name: 'resolved_by',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public resolvedBy!: number | null;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  public resolvedAt!: Date | null;
}
