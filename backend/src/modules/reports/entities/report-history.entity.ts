import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity({ name: 'report_histories' })
@Index('idx_report_histories_module_code', ['module', 'reportCode'])
@Index('idx_report_histories_download_token', ['downloadToken'])
@Index('idx_report_histories_schedule_id', ['scheduleId'])
export class ReportHistoryEntity extends TypeOrmBaseEntity {
  @Column({ name: 'report_code', type: 'varchar', length: 128 })
  public reportCode!: string;

  @Column({ name: 'module', type: 'varchar', length: 64 })
  public module!: string;

  @Column({ name: 'report_name', type: 'varchar', length: 255 })
  public reportName!: string;

  @Column({ name: 'actor_id', type: 'int', nullable: true, default: null })
  public actorId!: number | null;

  @Column({ name: 'job_id', type: 'varchar', length: 128, nullable: true, default: null })
  public jobId!: string | null;

  @Column({ name: 'schedule_id', type: 'int', nullable: true, default: null })
  public scheduleId!: number | null;

  @Column({ name: 'parameters_json', type: 'text', nullable: true, default: null })
  public parametersJson!: string | null;

  @Column({ name: 'execution_mode', type: 'varchar', length: 32, default: 'SYNC' })
  public executionMode!: 'SYNC' | 'QUEUE' | 'SCHEDULED';

  @Column({ name: 'data_source_used', type: 'varchar', length: 32, default: 'PRIMARY' })
  public dataSourceUsed!: 'REPLICA' | 'PRIMARY' | 'CACHE';

  @Column({ name: 'cache_hit', type: 'boolean', default: false })
  public cacheHit!: boolean;

  @Column({ name: 'cache_key', type: 'varchar', length: 255, nullable: true, default: null })
  public cacheKey!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'PROCESSING' })
  public status!: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

  @Column({ name: 'format', type: 'varchar', length: 16, nullable: true, default: null })
  public format!: 'csv' | 'xlsx' | 'pdf' | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true, default: null })
  public fileName!: string | null;

  @Column({ name: 'total_records', type: 'int', default: 0 })
  public totalRecords!: number;

  @Column({ name: 'summary_json', type: 'text', nullable: true, default: null })
  public summaryJson!: string | null;

  @Column({ name: 'download_token', type: 'varchar', length: 128, nullable: true, default: null })
  public downloadToken!: string | null;

  @Column({ name: 'download_url', type: 'varchar', length: 500, nullable: true, default: null })
  public downloadUrl!: string | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true, default: null })
  public expiresAt!: Date | null;

  @Column({ name: 'is_expired', type: 'boolean', default: false })
  public isExpired!: boolean;

  @Column({ name: 'notified_channels_json', type: 'text', nullable: true, default: null })
  public notifiedChannelsJson!: string | null;

  @Column({ name: 'recipient_emails_json', type: 'text', nullable: true, default: null })
  public recipientEmailsJson!: string | null;

  @Column({ name: 'recipient_user_ids_json', type: 'text', nullable: true, default: null })
  public recipientUserIdsJson!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true, default: null })
  public errorMessage!: string | null;

  @Column({ name: 'started_at', type: 'timestamp' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true, default: null })
  public completedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true, default: null })
  public durationMs!: number | null;
}
