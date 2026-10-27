import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity({ name: 'search_sync_histories' })
@Index('idx_search_sync_histories_module', ['module', 'operation'])
export class SearchSyncHistoryEntity extends TypeOrmBaseEntity {
  @Column({ name: 'operation', type: 'varchar', length: 32, default: 'SYNC' })
  public operation!: 'SYNC' | 'REBUILD' | 'REMOVE';

  @Column({ name: 'module', type: 'varchar', length: 64 })
  public module!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 64, nullable: true, default: null })
  public entityType!: string | null;

  @Column({ name: 'entity_code', type: 'varchar', length: 128, nullable: true, default: null })
  public entityCode!: string | null;

  @Column({ name: 'driver_used', type: 'varchar', length: 32, default: 'DATABASE' })
  public driverUsed!: 'DATABASE' | 'ELASTICSEARCH' | 'OPENSEARCH';

  @Column({ name: 'execution_mode', type: 'varchar', length: 32, default: 'SYNC' })
  public executionMode!: 'SYNC' | 'QUEUE';

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'COMPLETED' })
  public status!: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

  @Column({ name: 'indexed_count', type: 'int', default: 0 })
  public indexedCount!: number;

  @Column({ name: 'removed_count', type: 'int', default: 0 })
  public removedCount!: number;

  @Column({ name: 'job_id', type: 'varchar', length: 128, nullable: true, default: null })
  public jobId!: string | null;

  @Column({ name: 'actor_id', type: 'int', nullable: true, default: null })
  public actorId!: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true, default: null })
  public errorMessage!: string | null;

  @Column({ name: 'started_at', type: 'timestamp' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true, default: null })
  public completedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true, default: null })
  public durationMs!: number | null;
}
