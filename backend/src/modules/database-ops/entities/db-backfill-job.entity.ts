import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';

export type DbBackfillJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

const nullableBigintTransformer = {
  to: (value: number | null | undefined) => (value === undefined ? null : value),
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
};

const bigintTransformer = {
  to: (value: number | undefined) => value ?? 0,
  from: (value: string | number | null | undefined): number => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  },
};

@Entity({ name: 'db_backfill_jobs' })
@Index('UQ_db_backfill_jobs_code', ['jobCode'], { unique: true })
@Index('IDX_db_backfill_jobs_name_status', ['jobName', 'status'])
export class DbBackfillJobEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'job_code', type: 'varchar', length: 64 })
  public jobCode!: string;

  @Column({ name: 'job_name', type: 'varchar', length: 120 })
  public jobName!: string;

  @Column({ name: 'migration_name', type: 'varchar', length: 180, nullable: true })
  public migrationName!: string | null;

  @Column({ name: 'queue_job_id', type: 'varchar', length: 120, nullable: true })
  public queueJobId!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'QUEUED' })
  public status!: DbBackfillJobStatus;

  @Column({ name: 'batch_size', type: 'int', default: 500 })
  public batchSize!: number;

  @Column({ name: 'throttle_ms', type: 'int', default: 100 })
  public throttleMs!: number;

  @Column({
    name: 'processed_rows',
    type: 'bigint',
    default: 0,
    transformer: bigintTransformer,
  })
  public processedRows!: number;

  @Column({
    name: 'updated_rows',
    type: 'bigint',
    default: 0,
    transformer: bigintTransformer,
  })
  public updatedRows!: number;

  @Column({
    name: 'total_rows',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintTransformer,
  })
  public totalRows!: number | null;

  @Column({ type: 'int', default: 0 })
  public percent!: number;

  @Column({ name: 'last_cursor', type: 'varchar', length: 255, nullable: true })
  public lastCursor!: string | null;

  @Column({ name: 'dry_run', type: 'boolean', default: false })
  public dryRun!: boolean;

  @Column({ name: 'cancel_requested', type: 'boolean', default: false })
  public cancelRequested!: boolean;

  @Column({ name: 'triggered_by', type: 'varchar', length: 120 })
  public triggeredBy!: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  public startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;
}
