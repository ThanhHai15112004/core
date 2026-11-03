import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  CALENDAR_PARTICIPANT_ROLE,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_RSVP_STATUS,
  type CalendarParticipantRole,
  type CalendarParticipantType,
  type CalendarRsvpStatus,
} from '../enum/calendar.enum.js';

@Entity('calendar_event_participants')
@Index(['calendarEventId'])
@Index(['userId', 'rsvpStatus'])
@Index(['organizationUnitId'])
export class CalendarEventParticipantEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'calendar_event_id', type: 'int' })
  public calendarEventId!: number;

  /** USER | ORGANIZATION_UNIT */
  @Column({
    name: 'participant_type',
    type: 'varchar',
    length: 32,
    default: CALENDAR_PARTICIPANT_TYPE.USER,
  })
  public participantType!: CalendarParticipantType;

  @Index()
  @Column({ name: 'user_id', type: 'int', nullable: true })
  public userId?: number | null;

  @Index()
  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  /** ORGANIZER | REQUIRED | OPTIONAL | ATTENDEE */
  @Column({
    name: 'participant_role',
    type: 'varchar',
    length: 32,
    default: CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
  })
  public participantRole!: CalendarParticipantRole;

  @Column({ name: 'can_edit', type: 'boolean', default: false })
  public canEdit!: boolean;

  /** PENDING | ACCEPTED | DECLINED | TENTATIVE */
  @Column({
    name: 'rsvp_status',
    type: 'varchar',
    length: 32,
    default: CALENDAR_RSVP_STATUS.PENDING,
  })
  public rsvpStatus!: CalendarRsvpStatus;

  @Column({ name: 'response_note', type: 'varchar', length: 500, nullable: true })
  public responseNote?: string | null;

  @Column({ name: 'responded_at', type: 'timestamp', nullable: true })
  public respondedAt?: Date | null;

  @Column({ name: 'added_by_user_id', type: 'int', nullable: true })
  public addedByUserId?: number | null;
}
