import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { DrSyncScope, DrSyncStatus, DrSyncTrigger } from '../enum/dr-ops.enum.js';

@Entity({ name: 'dr_sync_runs' })
@Index('UQ_dr_sync_runs_code', ['syncCode'], { unique: true })
@Index('IDX_dr_sync_runs_profile_at', ['profileCode', 'startedAt'])
@Index('IDX_dr_sync_runs_status_at', ['status', 'startedAt'])
export class DrSyncRunEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'sync_code', type: 'varchar', length: 64 })
  public syncCode!: string;

  @Column({ name: 'profile_code', type: 'varchar', length: 64, default: 'DEFAULT' })
  public profileCode!: string;

  @Column({ type: 'varchar', length: 24, default: 'FULL' })
  public scope!: DrSyncScope;

  @Column({ name: 'trigger_source', type: 'varchar', length: 24, default: 'MANUAL' })
  public triggerSource!: DrSyncTrigger;

  @Column({ type: 'varchar', length: 24, default: 'RUNNING' })
  public status!: DrSyncStatus;

  @Column({ name: 'db_lag_seconds', type: 'int', nullable: true })
  public dbLagSeconds!: number | null;

  @Column({ name: 'db_checkpoint', type: 'varchar', length: 255, nullable: true })
  public dbCheckpoint!: string | null;

  @Column({ name: 'storage_synced_count', type: 'int', default: 0 })
  public storageSyncedCount!: number;

  @Column({ name: 'storage_skipped_count', type: 'int', default: 0 })
  public storageSkippedCount!: number;

  @Column({ name: 'storage_failed_count', type: 'int', default: 0 })
  public storageFailedCount!: number;

  @Column({ name: 'storage_synced_bytes', type: 'bigint', default: 0 })
  public storageSyncedBytes!: string | number;

  @Column({ name: 'actual_rpo_seconds', type: 'int', nullable: true })
  public actualRpoSeconds!: number | null;

  @Column({ name: 'rpo_target_seconds', type: 'int', default: 900 })
  public rpoTargetSeconds!: number;

  @Column({ name: 'rpo_met', type: 'boolean', default: false })
  public rpoMet!: boolean;

  @Column({ name: 'started_at', type: 'timestamp' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  public durationMs!: number | null;

  @Column({ name: 'actor_user_id', type: 'bigint', nullable: true })
  public actorUserId!: number | null;

  @Column({ name: 'actor_name', type: 'varchar', length: 160, nullable: true })
  public actorName!: string | null;

  @Column({ name: 'summary_json', type: 'text', nullable: true })
  public summaryJson!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  public errorMessage!: string | null;
}
