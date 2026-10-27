import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity({ name: 'import_histories' })
@Index('idx_import_histories_module_profile', ['module', 'profileCode'])
@Index('idx_import_histories_actor_status', ['actorId', 'status'])
@Index('idx_import_histories_job_id', ['jobId'])
export class ImportHistoryEntity extends TypeOrmBaseEntity {
  @Column({ name: 'profile_code', type: 'varchar', length: 64 })
  public profileCode!: string;

  @Column({ name: 'module', type: 'varchar', length: 64 })
  public module!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  public fileName!: string;

  @Column({ name: 'format', type: 'varchar', length: 16, default: 'xlsx' })
  public format!: 'xlsx' | 'csv' | 'json';

  @Column({ name: 'duplicate_strategy', type: 'varchar', length: 16, default: 'SKIP' })
  public duplicateStrategy!: 'SKIP' | 'UPDATE' | 'REJECT';

  @Column({ name: 'column_mapping_json', type: 'text', nullable: true, default: null })
  public columnMappingJson!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'QUEUED' })
  public status!: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

  @Column({ name: 'job_id', type: 'varchar', length: 128, nullable: true, default: null })
  public jobId!: string | null;

  @Column({ name: 'actor_id', type: 'int', nullable: true, default: null })
  public actorId!: number | null;

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  public totalRows!: number;

  @Column({ name: 'processed_rows', type: 'int', default: 0 })
  public processedRows!: number;

  @Column({ name: 'created_count', type: 'int', default: 0 })
  public createdCount!: number;

  @Column({ name: 'updated_count', type: 'int', default: 0 })
  public updatedCount!: number;

  @Column({ name: 'skipped_count', type: 'int', default: 0 })
  public skippedCount!: number;

  @Column({ name: 'failed_count', type: 'int', default: 0 })
  public failedCount!: number;

  @Column({ name: 'errors_json', type: 'text', nullable: true, default: null })
  public errorsJson!: string | null;

  @Column({ name: 'started_at', type: 'timestamp' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true, default: null })
  public completedAt!: Date | null;
}
