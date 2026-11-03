import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_HISTORY_ACTION_TYPE,
  type CalendarChangeSource,
  type CalendarHistoryActionType,
} from '../enum/calendar.enum.js';

@Entity('calendar_event_histories')
@Index(['calendarEventId', 'createdAt'])
@Index(['changeSource'])
export class CalendarEventHistoryEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'calendar_event_id', type: 'int' })
  public calendarEventId!: number;

  @Column({
    name: 'action_type',
    type: 'varchar',
    length: 64,
    default: CALENDAR_HISTORY_ACTION_TYPE.UPDATED,
  })
  public actionType!: CalendarHistoryActionType;

  /** WEB_UI | API | SCHEDULER | GOOGLE_SYNC | MICROSOFT_SYNC | SYSTEM */
  @Index()
  @Column({
    name: 'change_source',
    type: 'varchar',
    length: 32,
    default: CALENDAR_CHANGE_SOURCE.WEB_UI,
  })
  public changeSource!: CalendarChangeSource;

  @Index()
  @Column({ name: 'actor_user_id', type: 'int', nullable: true })
  public actorUserId?: number | null;

  @Column({ name: 'changed_fields_json', type: 'text', nullable: true })
  public changedFieldsJson?: string | null;

  @Column({ name: 'before_snapshot_json', type: 'text', nullable: true })
  public beforeSnapshotJson?: string | null;

  @Column({ name: 'after_snapshot_json', type: 'text', nullable: true })
  public afterSnapshotJson?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public reason?: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson?: string | null;
}
