import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { DrReconcileStatus, DrSyncScope } from '../enum/dr-ops.enum.js';

@Entity({ name: 'dr_reconciliation_reports' })
@Index('UQ_dr_reconciliation_reports_code', ['reportCode'], { unique: true })
@Index('IDX_dr_reconciliation_reports_profile_at', ['profileCode', 'startedAt'])
export class DrReconciliationReportEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'report_code', type: 'varchar', length: 64 })
  public reportCode!: string;

  @Column({ name: 'profile_code', type: 'varchar', length: 64, default: 'DEFAULT' })
  public profileCode!: string;

  @Column({ name: 'switch_execution_id', type: 'bigint', nullable: true })
  public switchExecutionId!: number | null;

  @Column({ type: 'varchar', length: 24, default: 'FULL' })
  public scope!: DrSyncScope;

  @Column({ type: 'varchar', length: 24, default: 'PASSED' })
  public status!: DrReconcileStatus;

  @Column({ name: 'db_tables_checked', type: 'int', default: 0 })
  public dbTablesChecked!: number;

  @Column({ name: 'db_missing_count', type: 'int', default: 0 })
  public dbMissingCount!: number;

  @Column({ name: 'db_duplicate_count', type: 'int', default: 0 })
  public dbDuplicateCount!: number;

  @Column({ name: 'db_mismatch_count', type: 'int', default: 0 })
  public dbMismatchCount!: number;

  @Column({ name: 'storage_objects_checked', type: 'int', default: 0 })
  public storageObjectsChecked!: number;

  @Column({ name: 'storage_missing_count', type: 'int', default: 0 })
  public storageMissingCount!: number;

  @Column({ name: 'storage_duplicate_count', type: 'int', default: 0 })
  public storageDuplicateCount!: number;

  @Column({ name: 'storage_mismatch_count', type: 'int', default: 0 })
  public storageMismatchCount!: number;

  @Column({ name: 'total_discrepancies', type: 'int', default: 0 })
  public totalDiscrepancies!: number;

  @Column({ name: 'findings_json', type: 'text', nullable: true })
  public findingsJson!: string | null;

  @Column({ name: 'actor_user_id', type: 'bigint', nullable: true })
  public actorUserId!: number | null;

  @Column({ name: 'actor_name', type: 'varchar', length: 160 })
  public actorName!: string;

  @Column({ name: 'started_at', type: 'timestamp' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  public durationMs!: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  public errorMessage!: string | null;
}
