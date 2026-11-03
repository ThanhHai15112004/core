import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  CALENDAR_EVENT_STATUS,
  CALENDAR_EVENT_TYPE,
  CALENDAR_VISIBILITY,
  type CalendarEventStatusCode,
  type CalendarVisibility,
} from '../enum/calendar.enum.js';

@Entity('calendar_events')
@Index(['startAt', 'endAt', 'status'])
@Index(['resourceCode', 'startAt', 'endAt'])
export class CalendarEventEntity extends VersionedTypeOrmEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'varchar', length: 255 })
  public title!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 64, default: CALENDAR_EVENT_TYPE.MEETING })
  public eventType!: string;

  /** 1 = SCHEDULED, 2 = IN_PROGRESS, 3 = COMPLETED, 4 = CANCELLED, 5 = POSTPONED */
  @Index()
  @Column({ type: 'int', default: CALENDAR_EVENT_STATUS.SCHEDULED })
  public status!: CalendarEventStatusCode;

  /** PUBLIC | INTERNAL | PRIVATE */
  @Column({ type: 'varchar', length: 32, default: CALENDAR_VISIBILITY.PUBLIC })
  public visibility!: CalendarVisibility;

  @Index()
  @Column({ name: 'start_at', type: 'timestamp' })
  public startAt!: Date;

  @Index()
  @Column({ name: 'end_at', type: 'timestamp' })
  public endAt!: Date;

  @Column({ type: 'varchar', length: 64, default: 'Asia/Ho_Chi_Minh' })
  public timezone!: string;

  @Column({ name: 'is_all_day', type: 'boolean', default: false })
  public isAllDay!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public location?: string | null;

  @Column({ name: 'meeting_url', type: 'varchar', length: 500, nullable: true })
  public meetingUrl?: string | null;

  @Index()
  @Column({ name: 'resource_code', type: 'varchar', length: 64, nullable: true })
  public resourceCode?: string | null;

  @Column({ name: 'resource_name', type: 'varchar', length: 180, nullable: true })
  public resourceName?: string | null;

  @Index()
  @Column({ name: 'owner_user_id', type: 'int' })
  public ownerUserId!: number;

  @Index()
  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  @Column({ name: 'recurrence_rule_json', type: 'text', nullable: true })
  public recurrenceRuleJson?: string | null;

  @Column({ name: 'reminders_json', type: 'text', nullable: true })
  public remindersJson?: string | null;

  @Column({ name: 'external_bindings_json', type: 'text', nullable: true })
  public externalBindingsJson?: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson?: string | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 500, nullable: true })
  public cancelReason?: string | null;
}
