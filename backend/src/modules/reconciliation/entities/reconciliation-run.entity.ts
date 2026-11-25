import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  RECONCILIATION_RUN_STATUS,
  RECONCILIATION_TRIGGER_MODE,
  type ReconciliationRunStatusCode,
  type ReconciliationTriggerMode,
} from '../enum/reconciliation.enum.js';
import {
  reconBigintTransformer,
  reconNullableBigintTransformer,
} from '../helpers/reconciliation-bigint.helper.js';

@Entity({ name: 'reconciliation_runs' })
@Index('UQ_recon_runs_code', ['runCode'], { unique: true })
@Index('IDX_recon_runs_job_created', ['jobId', 'createdAt'])
@Index('IDX_recon_runs_status_time', ['status', 'startedAt'])
export class ReconciliationRunEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'run_code', type: 'varchar', length: 64 })
  public runCode!: string;

  @Column({ name: 'job_id', type: 'bigint', transformer: reconBigintTransformer })
  public jobId!: number;

  @Column({ name: 'job_code', type: 'varchar', length: 64 })
  public jobCode!: string;

  @Column({ name: 'adapter_code', type: 'varchar', length: 64 })
  public adapterCode!: string;

  @Column({ name: 'target_module', type: 'varchar', length: 64 })
  public targetModule!: string;

  @Column({
    name: 'trigger_mode',
    type: 'varchar',
    length: 24,
    default: RECONCILIATION_TRIGGER_MODE.MANUAL,
  })
  public triggerMode!: ReconciliationTriggerMode;

  @Column({ type: 'smallint', default: RECONCILIATION_RUN_STATUS.QUEUED })
  public status!: ReconciliationRunStatusCode;

  @Column({ name: 'period_start', type: 'timestamp' })
  public periodStart!: Date;

  @Column({ name: 'period_end', type: 'timestamp' })
  public periodEnd!: Date;

  @Column({ name: 'total_internal_count', type: 'int', default: 0 })
  public totalInternalCount!: number;

  @Column({ name: 'total_external_count', type: 'int', default: 0 })
  public totalExternalCount!: number;

  @Column({ name: 'matched_count', type: 'int', default: 0 })
  public matchedCount!: number;

  @Column({ name: 'discrepancy_count', type: 'int', default: 0 })
  public discrepancyCount!: number;

  @Column({ name: 'missing_internal_count', type: 'int', default: 0 })
  public missingInternalCount!: number;

  @Column({ name: 'missing_external_count', type: 'int', default: 0 })
  public missingExternalCount!: number;

  @Column({ name: 'duplicate_count', type: 'int', default: 0 })
  public duplicateCount!: number;

  @Column({ name: 'status_mismatch_count', type: 'int', default: 0 })
  public statusMismatchCount!: number;

  @Column({ name: 'amount_mismatch_count', type: 'int', default: 0 })
  public amountMismatchCount!: number;

  @Column({ name: 'data_mismatch_count', type: 'int', default: 0 })
  public dataMismatchCount!: number;

  @Column({
    name: 'internal_total_amount',
    type: 'bigint',
    default: 0,
    transformer: reconBigintTransformer,
  })
  public internalTotalAmount!: number;

  @Column({
    name: 'external_total_amount',
    type: 'bigint',
    default: 0,
    transformer: reconBigintTransformer,
  })
  public externalTotalAmount!: number;

  @Column({
    name: 'amount_diff_total',
    type: 'bigint',
    default: 0,
    transformer: reconBigintTransformer,
  })
  public amountDiffTotal!: number;

  @Column({ type: 'varchar', length: 12, nullable: true })
  public currency!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 120, nullable: true })
  public correlationId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 200, nullable: true })
  public idempotencyKey!: string | null;

  @Column({ name: 'summary_json', type: 'text', nullable: true })
  public summaryJson!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  public errorMessage!: string | null;

  @Column({
    name: 'triggered_by',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public triggeredBy!: number | null;

  @Column({ name: 'started_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;
}
