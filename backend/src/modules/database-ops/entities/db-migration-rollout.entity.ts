import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { MigrationPhase, MigrationRiskLevel } from '@packages/database/index.js';

export type MigrationRolloutStatus =
  'RUNNING' | 'SUCCESS' | 'FAILED' | 'POST_CHECK_FAILED' | 'NO_OP';

@Entity({ name: 'db_migration_rollouts' })
@Index('UQ_db_migration_rollouts_code', ['rolloutCode'], { unique: true })
@Index('IDX_db_migration_rollouts_env_started', ['environment', 'startedAt'])
@Index('IDX_db_migration_rollouts_status', ['status', 'startedAt'])
export class DbMigrationRolloutEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'rollout_code', type: 'varchar', length: 64 })
  public rolloutCode!: string;

  @Column({ name: 'release_version', type: 'varchar', length: 80 })
  public releaseVersion!: string;

  @Column({ name: 'git_commit', type: 'varchar', length: 64, nullable: true })
  public gitCommit!: string | null;

  @Column({ type: 'varchar', length: 32 })
  public environment!: string;

  @Column({ type: 'varchar', length: 24, default: 'standard' })
  public phase!: MigrationPhase;

  @Column({ name: 'risk_level', type: 'varchar', length: 24, default: 'LOW' })
  public riskLevel!: MigrationRiskLevel;

  @Column({ type: 'varchar', length: 24, default: 'RUNNING' })
  public status!: MigrationRolloutStatus;

  @Column({ name: 'executed_migrations_json', type: 'text', nullable: true })
  public executedMigrationsJson!: string | null;

  @Column({ name: 'checksum_snapshot_json', type: 'text', nullable: true })
  public checksumSnapshotJson!: string | null;

  @Column({ name: 'approved_by', type: 'varchar', length: 120, nullable: true })
  public approvedBy!: string | null;

  @Column({ name: 'approval_ticket', type: 'varchar', length: 80, nullable: true })
  public approvalTicket!: string | null;

  @Column({ name: 'executed_by', type: 'varchar', length: 120 })
  public executedBy!: string;

  @Column({ name: 'backup_record_id', type: 'int', nullable: true })
  public backupRecordId!: number | null;

  @Column({ name: 'backup_code', type: 'varchar', length: 64, nullable: true })
  public backupCode!: string | null;

  @Column({ name: 'backup_verified', type: 'boolean', default: false })
  public backupVerified!: boolean;

  @Column({ name: 'lock_timeout_ms', type: 'int', nullable: true })
  public lockTimeoutMs!: number | null;

  @Column({ name: 'max_migration_duration_ms', type: 'int', nullable: true })
  public maxMigrationDurationMs!: number | null;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  public durationMs!: number;

  @Column({ name: 'preflight_report_json', type: 'text', nullable: true })
  public preflightReportJson!: string | null;

  @Column({ name: 'post_check_report_json', type: 'text', nullable: true })
  public postCheckReportJson!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'started_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  public finishedAt!: Date | null;
}
