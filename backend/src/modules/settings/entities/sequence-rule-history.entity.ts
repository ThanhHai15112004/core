import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('sequence_rule_histories')
export class SequenceRuleHistoryEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'sequence_id', type: 'int' })
  public sequenceId!: number;

  @Index()
  @Column({ name: 'sequence_key', type: 'varchar', length: 150 })
  public sequenceKey!: string;

  /** Hành động: `'CREATE' | 'UPDATE' | 'RESET_COUNTER' | 'ARCHIVE'` (Mục 5.5.8) */
  @Column({ type: 'varchar', length: 32 })
  public action!: string;

  @Column({ name: 'old_state_json', type: 'text', nullable: true })
  public oldStateJson?: string | null;

  @Column({ name: 'new_state_json', type: 'text' })
  public newStateJson!: string;

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
