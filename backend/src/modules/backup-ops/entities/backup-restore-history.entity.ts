import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { RestoreOperationType, RestoreScope, RestoreStatus } from '../enum/backup-ops.enum.js';
import { backupNullableBigintTransformer } from '../helpers/backup-bigint.helper.js';

@Entity({ name: 'backup_restore_histories' })
@Index('UQ_backup_restore_histories_code', ['restoreCode'], { unique: true })
@Index('IDX_backup_restore_histories_record', ['backupRecordId', 'startedAt'])
@Index('IDX_backup_restore_histories_op_at', ['operationType', 'startedAt'])
export class BackupRestoreHistoryEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'restore_code', type: 'varchar', length: 64 })
  public restoreCode!: string;

  @Column({
    name: 'backup_record_id',
    type: 'bigint',
    nullable: true,
    transformer: backupNullableBigintTransformer,
  })
  public backupRecordId!: number | null;

  @Column({ name: 'backup_code', type: 'varchar', length: 64, nullable: true })
  public backupCode!: string | null;

  @Column({ name: 'operation_type', type: 'varchar', length: 24, default: 'DRILL_ISOLATED' })
  public operationType!: RestoreOperationType;

  @Column({ type: 'varchar', length: 24, default: 'DATABASE' })
  public scope!: RestoreScope;

  @Column({ name: 'target_environment', type: 'varchar', length: 120 })
  public targetEnvironment!: string;

  @Column({ name: 'target_database', type: 'varchar', length: 120, nullable: true })
  public targetDatabase!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'RUNNING' })
  public status!: RestoreStatus;

  @Column({ name: 'verification_mode', type: 'varchar', length: 40, nullable: true })
  public verificationMode!: string | null;

  @Column({
    name: 'actor_user_id',
    type: 'bigint',
    nullable: true,
    transformer: backupNullableBigintTransformer,
  })
  public actorUserId!: number | null;

  @Column({ name: 'actor_name', type: 'varchar', length: 160 })
  public actorName!: string;

  @Column({ type: 'varchar', length: 1000 })
  public reason!: string;

  @Column({ name: 'started_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  public durationMs!: number | null;

  @Column({ name: 'verification_result_json', type: 'text', nullable: true })
  public verificationResultJson!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;
}
