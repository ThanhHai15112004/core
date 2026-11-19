import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  PAYMENT_RECONCILIATION_RUN_STATUS,
  type PaymentReconciliationRunStatusCode,
  type PaymentReconciliationSource,
} from '../enum/payments.enum.js';
import {
  bigintNumberTransformer,
  nullableBigintNumberTransformer,
} from '../helpers/payment-bigint.helper.js';

@Entity({ name: 'payment_reconciliations' })
@Index('UQ_pay_recon_code', ['reconciliationCode'], { unique: true })
@Index('IDX_pay_recon_provider_period', ['providerCode', 'periodStart', 'periodEnd'])
export class PaymentReconciliationEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'reconciliation_code', type: 'varchar', length: 64 })
  public reconciliationCode!: string;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'source_mode', type: 'varchar', length: 24 })
  public sourceMode!: PaymentReconciliationSource;

  @Column({ name: 'period_start', type: 'timestamp' })
  public periodStart!: Date;

  @Column({ name: 'period_end', type: 'timestamp' })
  public periodEnd!: Date;

  @Column({ type: 'smallint', default: PAYMENT_RECONCILIATION_RUN_STATUS.COMPLETED })
  public status!: PaymentReconciliationRunStatusCode;

  @Column({ name: 'total_internal_count', type: 'int', default: 0 })
  public totalInternalCount!: number;

  @Column({ name: 'total_provider_count', type: 'int', default: 0 })
  public totalProviderCount!: number;

  @Column({ name: 'matched_count', type: 'int', default: 0 })
  public matchedCount!: number;

  @Column({ name: 'mismatch_count', type: 'int', default: 0 })
  public mismatchCount!: number;

  @Column({ name: 'missing_at_provider_count', type: 'int', default: 0 })
  public missingAtProviderCount!: number;

  @Column({ name: 'missing_internally_count', type: 'int', default: 0 })
  public missingInternallyCount!: number;

  @Column({
    name: 'internal_total_amount',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  public internalTotalAmount!: number;

  @Column({
    name: 'provider_total_amount',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  public providerTotalAmount!: number;

  @Column({
    name: 'amount_difference',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  public amountDifference!: number;

  @Column({ type: 'varchar', length: 8, nullable: true })
  public currency!: string | null;

  @Column({ name: 'summary_json', type: 'text', nullable: true })
  public summaryJson!: string | null;

  @Column({ name: 'started_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public createdBy!: number | null;
}
