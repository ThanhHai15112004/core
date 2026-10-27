import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity({ name: 'export_histories' })
@Index('idx_export_histories_module_profile', ['module', 'profileCode'])
@Index('idx_export_histories_download_token', ['downloadToken'])
@Index('idx_export_histories_expires_at', ['isExpired', 'expiresAt'])
export class ExportHistoryEntity extends TypeOrmBaseEntity {
  @Column({ name: 'profile_code', type: 'varchar', length: 64 })
  public profileCode!: string;

  @Column({ name: 'module', type: 'varchar', length: 64 })
  public module!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  public fileName!: string;

  @Column({ name: 'format', type: 'varchar', length: 16, default: 'xlsx' })
  public format!: 'csv' | 'xlsx' | 'pdf';

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'QUEUED' })
  public status!: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

  @Column({ name: 'job_id', type: 'varchar', length: 128, nullable: true, default: null })
  public jobId!: string | null;

  @Column({ name: 'actor_id', type: 'int', nullable: true, default: null })
  public actorId!: number | null;

  @Column({ name: 'filters_json', type: 'text', nullable: true, default: null })
  public filtersJson!: string | null;

  @Column({ name: 'total_exported', type: 'int', default: 0 })
  public totalExported!: number;

  @Column({ name: 'processed_rows', type: 'int', default: 0 })
  public processedRows!: number;

  @Column({ name: 'max_rows_applied', type: 'int', default: 5000 })
  public maxRowsApplied!: number;

  @Column({ name: 'download_token', type: 'varchar', length: 128, nullable: true, default: null })
  public downloadToken!: string | null;

  @Column({ name: 'download_url', type: 'varchar', length: 500, nullable: true, default: null })
  public downloadUrl!: string | null;

  @Column({ name: 'content_type', type: 'varchar', length: 128, nullable: true, default: null })
  public contentType!: string | null;

  @Column({ name: 'file_size_bytes', type: 'int', default: 0 })
  public fileSizeBytes!: number;

  @Column({ name: 'file_payload_base64', type: 'text', nullable: true, default: null })
  public filePayloadBase64!: string | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true, default: null })
  public expiresAt!: Date | null;

  @Column({ name: 'is_expired', type: 'boolean', default: false })
  public isExpired!: boolean;

  @Column({ name: 'notified_at', type: 'timestamp', nullable: true, default: null })
  public notifiedAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true, default: null })
  public errorMessage!: string | null;

  @Column({ name: 'started_at', type: 'timestamp' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true, default: null })
  public completedAt!: Date | null;
}
