import type { IOrganizationsPublicService } from '@modules/organizations/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import type { CalendarEventParticipantEntity } from '../entities/calendar-event-participant.entity.js';
import type { CalendarEventEntity } from '../entities/calendar-event.entity.js';
import {
  CALENDAR_CONFLICT_TYPE,
  CALENDAR_EVENT_STATUS,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_RSVP_STATUS,
} from '../enum/calendar.enum.js';
import type { CalendarEventParticipantRepository } from '../repositories/calendar-event-participant.repository.js';
import type { CalendarEventRepository } from '../repositories/calendar-event.repository.js';
import type {
  CalendarConflictCheckResultView,
  CalendarConflictItemView,
  CalendarRecurrenceRule,
} from '../types/calendar.types.js';
import { expandEventOccurrences } from './calendar-recurrence.helper.js';

export interface CheckCalendarConflictsInput {
  readonly startAt: Date;
  readonly endAt: Date;
  readonly recurrenceRule?: CalendarRecurrenceRule | null | undefined;
  readonly ownerUserId?: number | null | undefined;
  readonly resourceCode?: string | null | undefined;
  readonly participantUserIds?: readonly number[] | undefined;
  readonly participantOrganizationUnitIds?: readonly number[] | undefined;
  readonly excludeEventId?: number | null | undefined;
}

/**
 * 9.7.5: Kiểm tra trùng lịch theo Người tham gia (User / Đơn vị) hoặc Tài nguyên (resourceCode),
 * hỗ trợ mở rộng cả các sự kiện lặp lại (DAILY / WEEKLY / MONTHLY).
 */
export async function checkCalendarScheduleConflicts(params: {
  input: CheckCalendarConflictsInput;
  eventRepository: CalendarEventRepository;
  participantRepository: CalendarEventParticipantRepository;
  usersPublicService?: IUsersPublicService | null | undefined;
  organizationsPublicService?: IOrganizationsPublicService | null | undefined;
  maxOccurrencesToCheck?: number | undefined;
}): Promise<CalendarConflictCheckResultView> {
  const {
    input,
    eventRepository,
    participantRepository,
    usersPublicService,
    organizationsPublicService,
    maxOccurrencesToCheck = 30,
  } = params;

  const syntheticTargetEvent = {
    id: input.excludeEventId ?? 0,
    code: 'CANDIDATE',
    title: 'Candidate Event',
    eventType: 'MEETING',
    status: CALENDAR_EVENT_STATUS.SCHEDULED,
    startAt: input.startAt,
    endAt: input.endAt,
    isAllDay: false,
    ownerUserId: input.ownerUserId ?? 0,
    organizationUnitId: null,
    recurrenceRuleJson: input.recurrenceRule ? JSON.stringify(input.recurrenceRule) : null,
  } as unknown as CalendarEventEntity;

  const targetOccurrences = expandEventOccurrences({
    event: syntheticTargetEvent,
    maxOccurrences: maxOccurrencesToCheck,
  });

  if (targetOccurrences.length === 0) {
    return {
      hasConflict: false,
      resourceConflictCount: 0,
      participantConflictCount: 0,
      conflicts: [],
    };
  }

  const minTargetMs = Math.min(...targetOccurrences.map((o) => new Date(o.startAt).getTime()));
  const maxTargetMs = Math.max(...targetOccurrences.map((o) => new Date(o.endAt).getTime()));
  const rangeStart = new Date(minTargetMs - 24 * 3600_000);
  const rangeEnd = new Date(maxTargetMs + 24 * 3600_000);

  const candidateUsers = new Set<number>();
  if (input.ownerUserId && Number(input.ownerUserId) > 0) {
    candidateUsers.add(Number(input.ownerUserId));
  }
  for (const uid of input.participantUserIds ?? []) {
    if (Number(uid) > 0) candidateUsers.add(Number(uid));
  }

  const candidateOrgUnits = new Set<number>();
  for (const oid of input.participantOrganizationUnitIds ?? []) {
    if (Number(oid) > 0) candidateOrgUnits.add(Number(oid));
  }

  if (candidateOrgUnits.size > 0 && usersPublicService?.findActiveUserIdsByOrganizationUnitIds) {
    let unitIdsToResolve = [...candidateOrgUnits];
    if (organizationsPublicService?.resolveDescendantUnitIds) {
      const desc = await organizationsPublicService
        .resolveDescendantUnitIds(unitIdsToResolve)
        .catch(() => unitIdsToResolve);
      unitIdsToResolve = [...new Set([...unitIdsToResolve, ...desc])];
    }
    const orgUsers = await usersPublicService
      .findActiveUserIdsByOrganizationUnitIds(unitIdsToResolve)
      .catch(() => [] as number[]);
    for (const uid of orgUsers) {
      if (Number(uid) > 0) candidateUsers.add(Number(uid));
    }
  }

  const normalizedResource = input.resourceCode?.trim()
    ? input.resourceCode.trim().toUpperCase()
    : null;

  const activeEvents = await eventRepository.findActiveEventsForConflictOrRange({
    ...(input.excludeEventId ? { excludeEventId: Number(input.excludeEventId) } : {}),
  });

  if (activeEvents.length === 0) {
    return {
      hasConflict: false,
      resourceConflictCount: 0,
      participantConflictCount: 0,
      conflicts: [],
    };
  }

  const allExistingParticipants = await participantRepository.findByEventIds(
    activeEvents.map((e) => Number(e.id)),
  );
  const partsByEvent = new Map<number, CalendarEventParticipantEntity[]>();
  for (const p of allExistingParticipants) {
    const eid = Number(p.calendarEventId);
    const list = partsByEvent.get(eid) ?? [];
    list.push(p);
    partsByEvent.set(eid, list);
  }

  const conflicts: CalendarConflictItemView[] = [];
  const seenKeys = new Set<string>();

  for (const existing of activeEvents) {
    if (existing.status === CALENDAR_EVENT_STATUS.CANCELLED) continue;

    const existingOccurrences = expandEventOccurrences({
      event: existing,
      rangeStart,
      rangeEnd,
      maxOccurrences: maxOccurrencesToCheck,
    });
    if (existingOccurrences.length === 0) continue;

    const existingParts = (partsByEvent.get(Number(existing.id)) ?? []).filter(
      (p) => p.rsvpStatus !== CALENDAR_RSVP_STATUS.DECLINED,
    );

    const existingUsers = new Set<number>();
    if (existing.ownerUserId) {
      existingUsers.add(Number(existing.ownerUserId));
    }
    const existingOrgUnits = new Set<number>();
    for (const ep of existingParts) {
      if (ep.participantType === CALENDAR_PARTICIPANT_TYPE.USER && ep.userId) {
        existingUsers.add(Number(ep.userId));
      } else if (
        ep.participantType === CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT &&
        ep.organizationUnitId
      ) {
        existingOrgUnits.add(Number(ep.organizationUnitId));
      }
    }

    if (existingOrgUnits.size > 0 && usersPublicService?.findActiveUserIdsByOrganizationUnitIds) {
      const unitUsers = await usersPublicService
        .findActiveUserIdsByOrganizationUnitIds([...existingOrgUnits])
        .catch(() => [] as number[]);
      for (const uid of unitUsers) {
        if (Number(uid) > 0) existingUsers.add(Number(uid));
      }
    }

    const existingResource = existing.resourceCode?.trim()
      ? existing.resourceCode.trim().toUpperCase()
      : null;

    for (const targetOcc of targetOccurrences) {
      const tStart = new Date(targetOcc.startAt).getTime();
      const tEnd = new Date(targetOcc.endAt).getTime();

      for (const existOcc of existingOccurrences) {
        const eStart = new Date(existOcc.startAt).getTime();
        const eEnd = new Date(existOcc.endAt).getTime();

        if (tStart < eEnd && tEnd > eStart) {
          const overlapStartIso = new Date(Math.max(tStart, eStart)).toISOString();
          const overlapEndIso = new Date(Math.min(tEnd, eEnd)).toISOString();

          // 1. Trùng tài nguyên (Resource Conflict)
          if (normalizedResource && existingResource && normalizedResource === existingResource) {
            const key = `RES:${existing.id}:${normalizedResource}:${overlapStartIso}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              conflicts.push({
                conflictType: CALENDAR_CONFLICT_TYPE.RESOURCE,
                conflictingEventId: Number(existing.id),
                conflictingEventCode: existing.code,
                conflictingEventTitle: existing.title,
                overlapStartAt: overlapStartIso,
                overlapEndAt: overlapEndIso,
                resourceCode: existing.resourceCode ?? normalizedResource,
                userId: null,
                organizationUnitId: null,
                message: `Trùng tài nguyên "${existing.resourceCode ?? normalizedResource}" với sự kiện "${existing.title}" (${existing.code})`,
              });
            }
          }

          // 2. Trùng người tham gia cá nhân (User Conflict)
          for (const uid of candidateUsers) {
            if (existingUsers.has(uid)) {
              const key = `USR:${existing.id}:${uid}:${overlapStartIso}`;
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                conflicts.push({
                  conflictType: CALENDAR_CONFLICT_TYPE.PARTICIPANT_USER,
                  conflictingEventId: Number(existing.id),
                  conflictingEventCode: existing.code,
                  conflictingEventTitle: existing.title,
                  overlapStartAt: overlapStartIso,
                  overlapEndAt: overlapEndIso,
                  resourceCode: null,
                  userId: uid,
                  organizationUnitId: null,
                  message: `Người tham gia #${uid} bị trùng lịch với sự kiện "${existing.title}" (${existing.code})`,
                });
              }
            }
          }

          // 3. Trùng đơn vị tham gia (Organization Unit Conflict)
          for (const oid of candidateOrgUnits) {
            if (existingOrgUnits.has(oid) || Number(existing.organizationUnitId) === oid) {
              const key = `ORG:${existing.id}:${oid}:${overlapStartIso}`;
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                conflicts.push({
                  conflictType: CALENDAR_CONFLICT_TYPE.PARTICIPANT_ORG_UNIT,
                  conflictingEventId: Number(existing.id),
                  conflictingEventCode: existing.code,
                  conflictingEventTitle: existing.title,
                  overlapStartAt: overlapStartIso,
                  overlapEndAt: overlapEndIso,
                  resourceCode: null,
                  userId: null,
                  organizationUnitId: oid,
                  message: `Đơn vị #${oid} bị trùng lịch với sự kiện "${existing.title}" (${existing.code})`,
                });
              }
            }
          }
        }
      }
    }
  }

  const resourceConflictCount = conflicts.filter(
    (c) => c.conflictType === CALENDAR_CONFLICT_TYPE.RESOURCE,
  ).length;
  const participantConflictCount = conflicts.length - resourceConflictCount;

  return {
    hasConflict: conflicts.length > 0,
    resourceConflictCount,
    participantConflictCount,
    conflicts,
  };
}
