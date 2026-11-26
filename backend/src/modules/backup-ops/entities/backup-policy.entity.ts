import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { BackupTargetType } from '../enum/backup-ops.enum.js';

@Entity({ name: 'backup_policies' })
@Index('UQ_backup_policies_code', ['code'], { unique: true })
@Index('IDX_backup_policies_enabled_type', ['isEnabled', 'targetType', 'deletedAt'])
export class BackupPolicyEntity extends VersionedTypeOrmEntity {
  @Column({ type: 'varchar', length: 80 })
  public code!: string;

  @Column({ type: 'varchar', length: 160 })
  public name!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 24 })
  public targetType!: BackupTargetType;

  @Column({ name: 'schedule_cron', type: 'varchar', length: 64 })
  public scheduleCron!: string;

  @Column({ type: 'varchar', length: 64, default: 'Asia/Ho_Chi_Minh' })
  public timezone!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  public isEnabled!: boolean;

  @Column({ name: 'encryption_enabled', type: 'boolean', default: true })
  public encryptionEnabled!: boolean;

  @Column({ name: 'compression_enabled', type: 'boolean', default: true })
  public compressionEnabled!: boolean;

  @Column({ name: 'retention_days', type: 'int', default: 14 })
  public retentionDays!: number;

  @Column({ name: 'max_keep_count', type: 'int', default: 30 })
  public maxKeepCount!: number;

  @Column({ name: 'auto_verify_drill', type: 'boolean', default: true })
  public autoVerifyDrill!: boolean;

  @Column({ name: 'alert_on_failure', type: 'boolean', default: true })
  public alertOnFailure!: boolean;

  @Column({ name: 'stale_threshold_hours', type: 'int', default: 26 })
  public staleThresholdHours!: number;

  @Column({ name: 'storage_prefix', type: 'varchar', length: 160, default: 'backups' })
  public storagePrefix!: string;

  @Column({ name: 'options_json', type: 'text', nullable: true })
  public optionsJson!: string | null;

  @Column({ name: 'last_run_at', type: 'timestamp', nullable: true })
  public lastRunAt!: Date | null;

  @Column({ name: 'last_status', type: 'varchar', length: 24, nullable: true })
  public lastStatus!: string | null;

  @Column({ name: 'next_run_at', type: 'timestamp', nullable: true })
  public nextRunAt!: Date | null;
}
