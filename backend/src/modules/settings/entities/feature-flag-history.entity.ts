import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('feature_flag_histories')
export class FeatureFlagHistoryEntity extends TypeOrmBaseEntity {
  /** ID Feature Flag tham chiếu `feature_flags.id` (Mục 5.2.8) */
  @Index()
  @Column({ name: 'flag_id', type: 'int' })
  public flagId!: number;

  /** Khóa Feature Flag tại thời điểm thay đổi */
  @Index()
  @Column({ name: 'flag_key', type: 'varchar', length: 150 })
  public flagKey!: string;

  /** Loại thao tác: `CREATE`, `UPDATE`, `TOGGLE`, `ARCHIVE` */
  @Index()
  @Column({ type: 'varchar', length: 32 })
  public action!: string;

  /** Snapshot cấu hình trước khi thay đổi (JSON) */
  @Column({ name: 'old_state_json', type: 'text', nullable: true })
  public oldStateJson?: string | null;

  /** Snapshot cấu hình sau khi thay đổi (JSON) */
  @Column({ name: 'new_state_json', type: 'text' })
  public newStateJson!: string;

  @Index()
  @Column({ name: 'actor_user_id', type: 'int', nullable: true })
  public actorUserId?: number | null;

  @Column({ name: 'actor_identifier', type: 'varchar', length: 150, nullable: true })
  public actorIdentifier?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public reason?: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  public ipAddress?: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  public userAgent?: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 128, nullable: true })
  public requestId?: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 128, nullable: true })
  public correlationId?: string | null;
}
