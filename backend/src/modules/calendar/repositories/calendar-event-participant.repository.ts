import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { CalendarEventParticipantEntity } from '../entities/calendar-event-participant.entity.js';
import {
  CALENDAR_PARTICIPANT_ROLE,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_RSVP_STATUS,
  type CalendarParticipantRole,
  type CalendarParticipantType,
  type CalendarRsvpStatus,
} from '../enum/calendar.enum.js';

export interface UpsertCalendarParticipantInput {
  readonly participantType: CalendarParticipantType;
  readonly userId?: number | null | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly role?: CalendarParticipantRole | undefined;
  readonly canEdit?: boolean | undefined;
  readonly rsvpStatus?: CalendarRsvpStatus | undefined;
  readonly responseNote?: string | null | undefined;
  readonly addedByUserId?: number | null | undefined;
}

@Injectable()
export class CalendarEventParticipantRepository extends BaseTypeOrmRepository<CalendarEventParticipantEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(CalendarEventParticipantEntity, dataSource, transactionManager);
  }

  public override async findById(id: number): Promise<CalendarEventParticipantEntity | null> {
    return this.executeReadOnly((repo) => repo.findOne({ where: { id: Number(id) } }));
  }

  public async findByEventId(calendarEventId: number): Promise<CalendarEventParticipantEntity[]> {
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { calendarEventId: Number(calendarEventId) },
        order: { id: 'ASC' },
      }),
    );
  }

  public async findByEventIds(
    calendarEventIds: readonly number[],
  ): Promise<CalendarEventParticipantEntity[]> {
    const cleanIds = [...new Set(calendarEventIds.map((i) => Number(i)).filter((i) => i > 0))];
    if (cleanIds.length === 0) return [];
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { calendarEventId: In(cleanIds) },
        order: { id: 'ASC' },
      }),
    );
  }

  public async replaceParticipantsForEvent(
    calendarEventId: number,
    items: readonly UpsertCalendarParticipantInput[],
    addedByUserId?: number | null,
  ): Promise<CalendarEventParticipantEntity[]> {
    await this.repository.delete({ calendarEventId: Number(calendarEventId) });
    if (items.length === 0) return [];

    const entities = items.map((item) =>
      this.repository.create({
        calendarEventId: Number(calendarEventId),
        participantType: item.participantType ?? CALENDAR_PARTICIPANT_TYPE.USER,
        userId:
          item.participantType === CALENDAR_PARTICIPANT_TYPE.USER && item.userId
            ? Number(item.userId)
            : null,
        organizationUnitId:
          item.participantType === CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT &&
          item.organizationUnitId
            ? Number(item.organizationUnitId)
            : null,
        participantRole: item.role ?? CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
        canEdit: Boolean(item.canEdit || item.role === CALENDAR_PARTICIPANT_ROLE.ORGANIZER),
        rsvpStatus: item.rsvpStatus ?? CALENDAR_RSVP_STATUS.PENDING,
        responseNote: item.responseNote ?? null,
        respondedAt:
          item.rsvpStatus && item.rsvpStatus !== CALENDAR_RSVP_STATUS.PENDING ? new Date() : null,
        addedByUserId: item.addedByUserId ?? addedByUserId ?? null,
      }),
    );
    return this.repository.save(entities);
  }

  public async deleteById(id: number): Promise<void> {
    await this.repository.delete({ id: Number(id) });
  }
}
