import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In, LessThanOrEqual } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { CalendarEventReminderEntity } from '../entities/calendar-event-reminder.entity.js';
import { CALENDAR_REMINDER_STATUS, type CalendarReminderStatus } from '../enum/calendar.enum.js';

export interface CreateCalendarReminderInput {
  readonly calendarEventId: number;
  readonly occurrenceStartAt: Date;
  readonly minutesBefore: number;
  readonly remindAt: Date;
  readonly channels: readonly string[];
  readonly status?: CalendarReminderStatus | undefined;
}

@Injectable()
export class CalendarEventReminderRepository extends BaseTypeOrmRepository<CalendarEventReminderEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(CalendarEventReminderEntity, dataSource, transactionManager);
  }

  public async findByEventId(calendarEventId: number): Promise<CalendarEventReminderEntity[]> {
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { calendarEventId: Number(calendarEventId) },
        order: { remindAt: 'ASC', id: 'ASC' },
      }),
    );
  }

  public async findByEventIds(
    calendarEventIds: readonly number[],
  ): Promise<CalendarEventReminderEntity[]> {
    const cleanIds = [...new Set(calendarEventIds.map((i) => Number(i)).filter((i) => i > 0))];
    if (cleanIds.length === 0) return [];
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { calendarEventId: In(cleanIds) },
        order: { remindAt: 'ASC', id: 'ASC' },
      }),
    );
  }

  public async findDuePendingReminders(now: Date): Promise<CalendarEventReminderEntity[]> {
    return this.executeReadOnly((repo) =>
      repo.find({
        where: {
          status: CALENDAR_REMINDER_STATUS.PENDING,
          remindAt: LessThanOrEqual(now),
        },
        order: { remindAt: 'ASC', id: 'ASC' },
      }),
    );
  }

  public async replacePendingRemindersForEvent(
    calendarEventId: number,
    inputs: readonly CreateCalendarReminderInput[],
  ): Promise<CalendarEventReminderEntity[]> {
    await this.repository.delete({
      calendarEventId: Number(calendarEventId),
      status: CALENDAR_REMINDER_STATUS.PENDING,
    });
    if (inputs.length === 0) return [];

    const entities = inputs.map((item) =>
      this.repository.create({
        calendarEventId: Number(item.calendarEventId),
        occurrenceStartAt: item.occurrenceStartAt,
        minutesBefore: Number(item.minutesBefore),
        remindAt: item.remindAt,
        channelsJson: JSON.stringify(item.channels),
        status: item.status ?? CALENDAR_REMINDER_STATUS.PENDING,
        notificationId: null,
        recipientCount: 0,
        sentAt: null,
        errorMessage: null,
      }),
    );
    return this.repository.save(entities);
  }

  public async cancelPendingRemindersForEvent(calendarEventId: number): Promise<void> {
    const pending = await this.findByEventId(calendarEventId);
    for (const item of pending) {
      if (item.status === CALENDAR_REMINDER_STATUS.PENDING) {
        item.status = CALENDAR_REMINDER_STATUS.SKIPPED;
        item.errorMessage = 'Event cancelled';
        await this.saveEntity(item);
      }
    }
  }
}
