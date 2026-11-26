import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type {
  BackupRecordStatus,
  BackupTargetType,
  BackupTriggerSource,
  BackupVerifyStatus,
} from '../enum/backup-ops.enum.js';
import { backupNullableBigintTransformer } from '../helpers/backup-bigint.helper.js';

@Entity({ name: 'backup_records' })
@Index('UQ_backup_records_code', ['backupCode'], { unique: true })
@Index('IDX_backup_records_policy_code', ['policyCode', 'startedAt'])
@Index('IDX_backup_records_type_status_at', ['targetType', 'status', 'startedAt'])
@Index('IDX_backup_records_expires_status', ['expiresAt', 'status'])
export class BackupRecordEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'backup_code', type: 'varchar', length: 64 })
  public backupCode!: string;

  @Column({
    name: 'policy_id',
    type: 'bigint',
    nullable: true,
    transformer: backupNullableBigintTransformer,
  })
  public policyId!: number | null;

  @Column({ name: 'policy_code', type: 'varchar', length: 80, nullable: true })
  public policyCode!: string | null;

  @Column({ name: 'target_type', type: 'varchar', length: 24 })
  public targetType!: BackupTargetType;

  @Column({ name: 'trigger_source', type: 'varchar', length: 24, default: 'MANUAL' })
  public triggerSource!: BackupTriggerSource;

  @Column({ type: 'varchar', length: 24, default: 'RUNNING' })
  public status!: BackupRecordStatus;

  @Column({ type: 'varchar', length: 40, nullable: true })
  public engine!: string | null;

  @Column({ name: 'storage_driver', type: 'varchar', length: 24, nullable: true })
  public storageDriver!: string | null;

  @Column({ name: 'storage_key', type: 'varchar', length: 500, nullable: true })
  public storageKey!: string | null;

  @Column({ type: 'boolean', default: true })
  public encrypted!: boolean;

  @Column({ name: 'encryption_algorithm', type: 'varchar', length: 40, nullable: true })
  public encryptionAlgorithm!: string | null;

  @Column({ type: 'boolean', default: true })
  public compressed!: boolean;

  @Column({
    name: 'original_size_bytes',
    type: 'bigint',
    nullable: true,
    transformer: backupNullableBigintTransformer,
  })
  public originalSizeBytes!: number | null;

  @Column({
    name: 'stored_size_bytes',
    type: 'bigint',
    nullable: true,
    transformer: backupNullableBigintTransformer,
  })
  public storedSizeBytes!: number | null;

  @Column({ name: 'plaintext_sha256', type: 'varchar', length: 64, nullable: true })
  public plaintextSha256!: string | null;

  @Column({ name: 'artifact_sha256', type: 'varchar', length: 64, nullable: true })
  public artifactSha256!: string | null;

  @Column({ name: 'retention_days', type: 'int', default: 14 })
  public retentionDays!: number;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  public expiresAt!: Date | null;

  @Column({ name: 'started_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  public durationMs!: number | null;

  @Column({ name: 'verify_status', type: 'varchar', length: 24, default: 'PENDING' })
  public verifyStatus!: BackupVerifyStatus;

  @Column({ name: 'last_verified_at', type: 'timestamp', nullable: true })
  public lastVerifiedAt!: Date | null;

  @Column({ name: 'verify_summary_json', type: 'text', nullable: true })
  public verifySummaryJson!: string | null;

  @Column({
    name: 'triggered_by_user_id',
    type: 'bigint',
    nullable: true,
    transformer: backupNullableBigintTransformer,
  })
  public triggeredByUserId!: number | null;

  @Column({ name: 'triggered_by_name', type: 'varchar', length: 160, nullable: true })
  public triggeredByName!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;
}
