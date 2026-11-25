import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  RECONCILIATION_DISCREPANCY_STATUS,
  RECONCILIATION_SEVERITY,
  type ReconciliationDiscrepancyStatusCode,
  type ReconciliationDiscrepancyTypeCode,
  type ReconciliationSeverityCode,
} from '../enum/reconciliation.enum.js';
import {
  reconBigintTransformer,
  reconNullableBigintTransformer,
} from '../helpers/reconciliation-bigint.helper.js';

@Entity({ name: 'reconciliation_discrepancies' })
@Index('UQ_recon_disc_code', ['discrepancyCode'], { unique: true })
@Index('IDX_recon_disc_run_type_status', ['runId', 'discrepancyType', 'status'])
@Index('IDX_recon_disc_severity_assignee', ['severity', 'assigneeUserId', 'status'])
@Index('IDX_recon_disc_record_key', ['recordKey', 'jobId'])
export class ReconciliationDiscrepancyEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'discrepancy_code', type: 'varchar', length: 64 })
  public discrepancyCode!: string;

  @Column({ name: 'run_id', type: 'bigint', transformer: reconBigintTransformer })
  public runId!: number;

  @Column({ name: 'job_id', type: 'bigint', transformer: reconBigintTransformer })
  public jobId!: number;

  @Column({ name: 'target_module', type: 'varchar', length: 64 })
  public targetModule!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 80, nullable: true })
  public entityType!: string | null;

  @Column({ name: 'entity_id', type: 'varchar', length: 128, nullable: true })
  public entityId!: string | null;

  @Column({ name: 'record_key', type: 'varchar', length: 180 })
  public recordKey!: string;

  @Column({ name: 'discrepancy_type', type: 'smallint' })
  public discrepancyType!: ReconciliationDiscrepancyTypeCode;

  @Column({ type: 'smallint', default: RECONCILIATION_SEVERITY.MEDIUM })
  public severity!: ReconciliationSeverityCode;

  @Column({ type: 'smallint', default: RECONCILIATION_DISCREPANCY_STATUS.OPEN })
  public status!: ReconciliationDiscrepancyStatusCode;

  @Column({
    name: 'assignee_user_id',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public assigneeUserId!: number | null;

  @Column({ name: 'internal_status', type: 'varchar', length: 64, nullable: true })
  public internalStatus!: string | null;

  @Column({ name: 'external_status', type: 'varchar', length: 64, nullable: true })
  public externalStatus!: string | null;

  @Column({
    name: 'internal_amount',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public internalAmount!: number | null;

  @Column({
    name: 'external_amount',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public externalAmount!: number | null;

  @Column({
    name: 'amount_diff',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public amountDiff!: number | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  public currency!: string | null;

  @Column({ name: 'internal_snapshot_json', type: 'text', nullable: true })
  public internalSnapshotJson!: string | null;

  @Column({ name: 'external_snapshot_json', type: 'text', nullable: true })
  public externalSnapshotJson!: string | null;

  @Column({ name: 'diff_fields_json', type: 'text', nullable: true })
  public diffFieldsJson!: string | null;

  @Column({ name: 'resolution_note', type: 'varchar', length: 500, nullable: true })
  public resolutionNote!: string | null;

  @Column({
    name: 'resolved_by',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public resolvedBy!: number | null;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  public resolvedAt!: Date | null;
}
