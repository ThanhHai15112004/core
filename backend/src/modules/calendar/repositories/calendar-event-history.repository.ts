import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { CalendarEventHistoryEntity } from '../entities/calendar-event-history.entity.js';
import {
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_HISTORY_ACTION_TYPE,
  type CalendarChangeSource,
  type CalendarHistoryActionType,
} from '../enum/calendar.enum.js';

export interface RecordCalendarEventHistoryInput {
  readonly calendarEventId: number;
  readonly actionType?: CalendarHistoryActionType | undefined;
  readonly changeSource?: CalendarChangeSource | undefined;
  readonly actorUserId?: number | null | undefined;
  readonly changedFields?: readonly string[] | undefined;
  readonly beforeSnapshot?: Record<string, unknown> | null | undefined;
  readonly afterSnapshot?: Record<string, unknown> | null | undefined;
  readonly reason?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
}

@Injectable()
export class CalendarEventHistoryRepository extends BaseTypeOrmRepository<CalendarEventHistoryEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(CalendarEventHistoryEntity, dataSource, transactionManager);
  }

  public async findByEventId(
    calendarEventId: number,
    filter?: {
      changeSource?: CalendarChangeSource | undefined;
      actionType?: CalendarHistoryActionType | undefined;
    },
  ): Promise<CalendarEventHistoryEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const items = await repo.find({
        where: { calendarEventId: Number(calendarEventId) },
        order: { id: 'ASC' },
      });
      return items.filter((item) => {
        if (filter?.changeSource && item.changeSource !== filter.changeSource) return false;
        if (filter?.actionType && item.actionType !== filter.actionType) return false;
        return true;
      });
    });
  }

  public async recordHistory(
    input: RecordCalendarEventHistoryInput,
  ): Promise<CalendarEventHistoryEntity> {
    const entity = this.repository.create({
      calendarEventId: Number(input.calendarEventId),
      actionType: input.actionType ?? CALENDAR_HISTORY_ACTION_TYPE.UPDATED,
      changeSource: input.changeSource ?? CALENDAR_CHANGE_SOURCE.WEB_UI,
      actorUserId: input.actorUserId ?? null,
      changedFieldsJson: input.changedFields ? JSON.stringify(input.changedFields) : null,
      beforeSnapshotJson: input.beforeSnapshot ? JSON.stringify(input.beforeSnapshot) : null,
      afterSnapshotJson: input.afterSnapshot ? JSON.stringify(input.afterSnapshot) : null,
      reason: input.reason ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    });
    return this.repository.save(entity);
  }
}
