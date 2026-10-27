import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity({ name: 'report_schedules' })
@Index('idx_report_schedules_module_code', ['module', 'reportCode'])
@Index('idx_report_schedules_active_due', ['isActive', 'nextRunAt'])
export class ReportScheduleEntity extends TypeOrmBaseEntity {
  @Column({ name: 'report_code', type: 'varchar', length: 128 })
  public reportCode!: string;

  @Column({ name: 'module', type: 'varchar', length: 64 })
  public module!: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  public name!: string;

  @Column({ name: 'frequency', type: 'varchar', length: 32, default: 'DAILY' })
  public frequency!: 'DAILY' | 'WEEKLY' | 'MONTHLY';

  @Column({ name: 'cron_expression', type: 'varchar', length: 64 })
  public cronExpression!: string;

  @Column({ name: 'hour', type: 'int', default: 8 })
  public hour!: number;

  @Column({ name: 'minute', type: 'int', default: 0 })
  public minute!: number;

  @Column({ name: 'day_of_week', type: 'int', nullable: true, default: null })
  public dayOfWeek!: number | null;

  @Column({ name: 'day_of_month', type: 'int', nullable: true, default: null })
  public dayOfMonth!: number | null;

  @Column({ name: 'timezone', type: 'varchar', length: 64, default: 'Asia/Ho_Chi_Minh' })
  public timezone!: string;

  @Column({ name: 'format', type: 'varchar', length: 16, default: 'xlsx' })
  public format!: 'csv' | 'xlsx' | 'pdf';

  @Column({ name: 'parameters_json', type: 'text', nullable: true, default: null })
  public parametersJson!: string | null;

  @Column({ name: 'channels_json', type: 'text', nullable: true, default: null })
  public channelsJson!: string | null;

  @Column({ name: 'recipient_emails_json', type: 'text', nullable: true, default: null })
  public recipientEmailsJson!: string | null;

  @Column({ name: 'recipient_user_ids_json', type: 'text', nullable: true, default: null })
  public recipientUserIdsJson!: string | null;

  @Column({ name: 'ttl_seconds', type: 'int', default: 3600 })
  public ttlSeconds!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  public isActive!: boolean;

  @Column({ name: 'actor_id', type: 'int', nullable: true, default: null })
  public actorId!: number | null;

  @Column({ name: 'last_run_at', type: 'timestamp', nullable: true, default: null })
  public lastRunAt!: Date | null;

  @Column({ name: 'next_run_at', type: 'timestamp' })
  public nextRunAt!: Date;

  @Column({ name: 'last_history_id', type: 'int', nullable: true, default: null })
  public lastHistoryId!: number | null;
}
