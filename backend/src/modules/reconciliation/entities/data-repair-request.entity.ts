import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  DATA_REPAIR_ACTION_MODE,
  DATA_REPAIR_STATUS,
  type DataRepairActionMode,
  type DataRepairStatusCode,
} from '../enum/reconciliation.enum.js';
import { reconNullableBigintTransformer } from '../helpers/reconciliation-bigint.helper.js';

@Entity({ name: 'data_repair_requests' })
@Index('UQ_data_repair_code', ['repairCode'], { unique: true })
@Index('IDX_data_repair_status_sensitive', ['status', 'isSensitive', 'createdAt'])
@Index('IDX_data_repair_discrepancy', ['discrepancyId'])
@Index('IDX_data_repair_parent', ['parentRepairId'])
export class DataRepairRequestEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'repair_code', type: 'varchar', length: 64 })
  public repairCode!: string;

  @Column({
    name: 'discrepancy_id',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public discrepancyId!: number | null;

  @Column({
    name: 'parent_repair_id',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public parentRepairId!: number | null;

  @Column({
    name: 'action_mode',
    type: 'varchar',
    length: 32,
    default: DATA_REPAIR_ACTION_MODE.DIRECT_REPAIR,
  })
  public actionMode!: DataRepairActionMode;

  @Column({ name: 'handler_code', type: 'varchar', length: 80 })
  public handlerCode!: string;

  @Column({ name: 'target_module', type: 'varchar', length: 64 })
  public targetModule!: string;

  @Column({ name: 'target_entity_type', type: 'varchar', length: 80 })
  public targetEntityType!: string;

  @Column({ name: 'target_entity_id', type: 'varchar', length: 128 })
  public targetEntityId!: string;

  @Column({ name: 'is_sensitive', type: 'boolean', default: false })
  public isSensitive!: boolean;

  @Column({ name: 'sensitivity_reasons_json', type: 'text', nullable: true })
  public sensitivityReasonsJson!: string | null;

  @Column({ name: 'can_rollback', type: 'boolean', default: true })
  public canRollback!: boolean;

  @Column({ type: 'smallint', default: DATA_REPAIR_STATUS.DRAFT_PREVIEW })
  public status!: DataRepairStatusCode;

  @Column({ type: 'varchar', length: 500 })
  public reason!: string;

  @Column({ name: 'payload_json', type: 'text', nullable: true })
  public payloadJson!: string | null;

  @Column({ name: 'dry_run_preview_json', type: 'text', nullable: true })
  public dryRunPreviewJson!: string | null;

  @Column({ name: 'before_snapshot_json', type: 'text', nullable: true })
  public beforeSnapshotJson!: string | null;

  @Column({ name: 'after_snapshot_json', type: 'text', nullable: true })
  public afterSnapshotJson!: string | null;

  @Column({ name: 'field_diffs_json', type: 'text', nullable: true })
  public fieldDiffsJson!: string | null;

  @Column({ name: 'compensation_type', type: 'varchar', length: 64, nullable: true })
  public compensationType!: string | null;

  @Column({ name: 'compensation_details_json', type: 'text', nullable: true })
  public compensationDetailsJson!: string | null;

  @Column({
    name: 'requested_by',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public requestedBy!: number | null;

  @Column({
    name: 'approved_by',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public approvedBy!: number | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  public approvedAt!: Date | null;

  @Column({
    name: 'rejected_by',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public rejectedBy!: number | null;

  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true })
  public rejectedAt!: Date | null;

  @Column({ name: 'approval_note', type: 'varchar', length: 500, nullable: true })
  public approvalNote!: string | null;

  @Column({
    name: 'executed_by',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public executedBy!: number | null;

  @Column({ name: 'executed_at', type: 'timestamp', nullable: true })
  public executedAt!: Date | null;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  public errorMessage!: string | null;
}
