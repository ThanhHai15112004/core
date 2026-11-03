import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { CALENDAR_REMINDER_STATUS, type CalendarReminderStatus } from '../enum/calendar.enum.js';

@Entity('calendar_event_reminders')
@Index(['status', 'remindAt'])
@Index(['calendarEventId'])
export class CalendarEventReminderEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'calendar_event_id', type: 'int' })
  public calendarEventId!: number;

  @Column({ name: 'occurrence_start_at', type: 'timestamp' })
  public occurrenceStartAt!: Date;

  @Column({ name: 'minutes_before', type: 'int', default: 15 })
  public minutesBefore!: number;

  @Index()
  @Column({ name: 'remind_at', type: 'timestamp' })
  public remindAt!: Date;

  @Column({ name: 'channels_json', type: 'text', nullable: true })
  public channelsJson?: string | null;

  /** PENDING | SENT | SKIPPED | FAILED */
  @Index()
  @Column({
    type: 'varchar',
    length: 32,
    default: CALENDAR_REMINDER_STATUS.PENDING,
  })
  public status!: CalendarReminderStatus;

  @Column({ name: 'notification_id', type: 'int', nullable: true })
  public notificationId?: number | null;

  @Column({ name: 'recipient_count', type: 'int', default: 0 })
  public recipientCount!: number;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  public sentAt?: Date | null;

  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true })
  public errorMessage?: string | null;
}
