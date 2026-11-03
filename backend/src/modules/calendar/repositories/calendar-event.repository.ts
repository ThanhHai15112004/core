import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import type { CountMode } from '@packages/kernel/index.js';
import {
  BaseTypeOrmRepository,
  type DataScopeQueryFilterInput,
  TransactionManager,
} from '@packages/database/index.js';
import { CalendarEventEntity } from '../entities/calendar-event.entity.js';
import {
  CALENDAR_EVENT_STATUS,
  type CalendarEventStatusCode,
  type CalendarVisibility,
} from '../enum/calendar.enum.js';

export interface SearchCalendarEventsFilter {
  readonly search?: string | undefined;
  readonly eventType?: string | undefined;
  readonly status?: CalendarEventStatusCode | number | undefined;
  readonly visibility?: CalendarVisibility | undefined;
  readonly ownerUserId?: number | undefined;
  readonly organizationUnitId?: number | undefined;
  readonly participantUserId?: number | undefined;
  readonly participantOrgUnitId?: number | undefined;
  readonly resourceCode?: string | undefined;
  readonly fromDate?: Date | string | undefined;
  readonly toDate?: Date | string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: CountMode | undefined;
  readonly scopeFilter?: DataScopeQueryFilterInput | undefined;
}

@Injectable()
export class CalendarEventRepository extends BaseTypeOrmRepository<CalendarEventEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(CalendarEventEntity, dataSource, transactionManager);
  }

  public override async findById(id: number): Promise<CalendarEventEntity | null> {
    return this.executeReadOnly((repo) => repo.findOne({ where: { id: Number(id) } }));
  }

  public async findByIds(ids: readonly number[]): Promise<CalendarEventEntity[]> {
    const cleanIds = [...new Set(ids.map((i) => Number(i)).filter((i) => i > 0))];
    if (cleanIds.length === 0) return [];
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { id: In(cleanIds) },
        order: { startAt: 'ASC', id: 'ASC' },
      }),
    );
  }

  public async findByCode(code: string): Promise<CalendarEventEntity | null> {
    const normalized = code.trim().toUpperCase();
    return this.executeReadOnly((repo) =>
      repo.createQueryBuilder('e').where('UPPER(e.code) = :code', { code: normalized }).getOne(),
    );
  }

  public async findActiveEventsForConflictOrRange(params?: {
    excludeEventId?: number | undefined;
  }): Promise<CalendarEventEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('e').where('e.status IN (:...statuses)', {
        statuses: [
          CALENDAR_EVENT_STATUS.SCHEDULED,
          CALENDAR_EVENT_STATUS.IN_PROGRESS,
          CALENDAR_EVENT_STATUS.POSTPONED,
        ],
      });
      if (params?.excludeEventId) {
        qb.andWhere('e.id != :excludeId', { excludeId: Number(params.excludeEventId) });
      }
      qb.orderBy('e.start_at', 'ASC');
      return qb.getMany();
    });
  }

  public async searchPaginated(filter: SearchCalendarEventsFilter = {}): Promise<{
    readonly items: CalendarEventEntity[];
    readonly total: number;
  }> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('e');

      if (filter.search?.trim()) {
        const q = `%${filter.search.trim().toLowerCase()}%`;
        qb.andWhere(
          "(LOWER(e.title) LIKE :q OR LOWER(e.code) LIKE :q OR LOWER(COALESCE(e.location, '')) LIKE :q OR LOWER(COALESCE(e.resource_code, '')) LIKE :q)",
          { q },
        );
      }
      if (filter.eventType?.trim()) {
        qb.andWhere('UPPER(e.event_type) = :eventType', {
          eventType: filter.eventType.trim().toUpperCase(),
        });
      }
      if (filter.status !== undefined) {
        qb.andWhere('e.status = :status', { status: filter.status });
      }
      if (filter.visibility?.trim()) {
        qb.andWhere('UPPER(e.visibility) = :visibility', {
          visibility: filter.visibility.trim().toUpperCase(),
        });
      }
      if (filter.ownerUserId !== undefined) {
        qb.andWhere('e.owner_user_id = :ownerUserId', {
          ownerUserId: Number(filter.ownerUserId),
        });
      }
      if (filter.organizationUnitId !== undefined) {
        qb.andWhere('e.organization_unit_id = :organizationUnitId', {
          organizationUnitId: Number(filter.organizationUnitId),
        });
      }
      if (filter.resourceCode?.trim()) {
        qb.andWhere('UPPER(e.resource_code) = :resourceCode', {
          resourceCode: filter.resourceCode.trim().toUpperCase(),
        });
      }
      if (filter.fromDate) {
        const from = new Date(filter.fromDate);
        if (!Number.isNaN(from.getTime())) {
          qb.andWhere('(e.end_at >= :fromDate OR e.recurrence_rule_json IS NOT NULL)', {
            fromDate: from,
          });
        }
      }
      if (filter.toDate) {
        const to = new Date(filter.toDate);
        if (!Number.isNaN(to.getTime())) {
          qb.andWhere('e.start_at <= :toDate', { toDate: to });
        }
      }
      if (filter.participantUserId !== undefined) {
        qb.andWhere(
          `(e.owner_user_id = :participantUserId OR EXISTS (
            SELECT 1 FROM calendar_event_participants p
            WHERE p.calendar_event_id = e.id
              AND p.deleted_at IS NULL
              AND p.user_id = :participantUserId
          ))`,
          { participantUserId: Number(filter.participantUserId) },
        );
      }
      if (filter.participantOrgUnitId !== undefined) {
        qb.andWhere(
          `(e.organization_unit_id = :participantOrgUnitId OR EXISTS (
            SELECT 1 FROM calendar_event_participants p
            WHERE p.calendar_event_id = e.id
              AND p.deleted_at IS NULL
              AND p.organization_unit_id = :participantOrgUnitId
          ))`,
          { participantOrgUnitId: Number(filter.participantOrgUnitId) },
        );
      }

      if (filter.scopeFilter) {
        this.applyDataScope(qb, filter.scopeFilter, {
          userColumn: 'e.owner_user_id',
          orgUnitColumn: 'e.organization_unit_id',
        });
      }

      qb.orderBy('e.start_at', 'ASC').addOrderBy('e.id', 'DESC');

      return this.paginateQueryBuilder(qb, {
        page: filter.page ?? 1,
        limit: filter.limit ?? 20,
        ...(filter.countMode ? { countMode: filter.countMode } : {}),
      });
    });
  }
}
