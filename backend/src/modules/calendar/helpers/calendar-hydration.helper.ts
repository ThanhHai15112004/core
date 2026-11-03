import { safeJsonParseObject, safeJsonParseStringArray } from '@packages/kernel/index.js';
import type { IOrganizationsPublicService } from '@modules/organizations/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import { getCalendarEventStatusName } from '../contracts/index.js';
import type { CalendarEventHistoryEntity } from '../entities/calendar-event-history.entity.js';
import type { CalendarEventParticipantEntity } from '../entities/calendar-event-participant.entity.js';
import type { CalendarEventReminderEntity } from '../entities/calendar-event-reminder.entity.js';
import type { CalendarEventEntity } from '../entities/calendar-event.entity.js';
import type {
  CalendarEventAccessEvaluation,
  CalendarEventDetailView,
  CalendarEventHistoryItemView,
  CalendarEventItemView,
  CalendarEventParticipantItemView,
  CalendarEventReminderItemView,
  CalendarExternalBindingsMap,
} from '../types/calendar.types.js';
import {
  expandEventOccurrences,
  parseRecurrenceRule,
  parseReminderRules,
} from './calendar-recurrence.helper.js';

export function parseExternalBindings(raw: string | null | undefined): CalendarExternalBindingsMap {
  if (!raw || !raw.trim()) return {};
  return safeJsonParseObject<CalendarExternalBindingsMap>(raw);
}

export function buildEventSnapshot(
  event: CalendarEventEntity,
  participants?: readonly CalendarEventParticipantEntity[],
): Record<string, unknown> {
  return {
    id: Number(event.id),
    code: event.code,
    title: event.title,
    description: event.description ?? null,
    eventType: event.eventType,
    status: event.status,
    visibility: event.visibility,
    startAt: new Date(event.startAt).toISOString(),
    endAt: new Date(event.endAt).toISOString(),
    timezone: event.timezone,
    isAllDay: Boolean(event.isAllDay),
    location: event.location ?? null,
    meetingUrl: event.meetingUrl ?? null,
    resourceCode: event.resourceCode ?? null,
    resourceName: event.resourceName ?? null,
    ownerUserId: Number(event.ownerUserId),
    organizationUnitId: event.organizationUnitId ?? null,
    recurrenceRule: parseRecurrenceRule(event.recurrenceRuleJson),
    reminderRules: parseReminderRules(event.remindersJson),
    ...(participants
      ? {
          participants: participants.map((p) => ({
            participantType: p.participantType,
            userId: p.userId ?? null,
            organizationUnitId: p.organizationUnitId ?? null,
            role: p.participantRole,
            canEdit: Boolean(p.canEdit),
            rsvpStatus: p.rsvpStatus,
          })),
        }
      : {}),
  };
}

export function computeChangedFields(
  beforeSnapshot: Record<string, unknown>,
  afterSnapshot: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(beforeSnapshot), ...Object.keys(afterSnapshot)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(beforeSnapshot[k]) !== JSON.stringify(afterSnapshot[k])) {
      changed.push(k);
    }
  }
  return changed;
}

export async function hydrateCalendarEventsList(params: {
  events: readonly CalendarEventEntity[];
  participants: readonly CalendarEventParticipantEntity[];
  usersPublicService?: IUsersPublicService | null | undefined;
  organizationsPublicService?: IOrganizationsPublicService | null | undefined;
  defaultReminderMinutes?: number | undefined;
}): Promise<CalendarEventItemView[]> {
  const {
    events,
    participants,
    usersPublicService,
    organizationsPublicService,
    defaultReminderMinutes = 15,
  } = params;
  if (events.length === 0) return [];

  const userIds = new Set<number>();
  const unitIds = new Set<number>();
  for (const ev of events) {
    if (ev.ownerUserId) userIds.add(Number(ev.ownerUserId));
    if (ev.organizationUnitId) unitIds.add(Number(ev.organizationUnitId));
  }

  const [contacts, units] = await Promise.all([
    userIds.size > 0 && usersPublicService?.findUserContactsByIds
      ? usersPublicService.findUserContactsByIds([...userIds]).catch(() => [])
      : Promise.resolve([]),
    unitIds.size > 0 && organizationsPublicService
      ? organizationsPublicService.findByIds([...unitIds]).catch(() => [])
      : Promise.resolve([]),
  ]);

  const userMap = new Map(contacts.map((u) => [Number(u.id), u]));
  const unitMap = new Map(units.map((u) => [Number(u.id), u]));

  const partCountByEvent = new Map<number, number>();
  for (const p of participants) {
    const eid = Number(p.calendarEventId);
    partCountByEvent.set(eid, (partCountByEvent.get(eid) ?? 0) + 1);
  }

  return events.map((ev) => {
    const startMs = new Date(ev.startAt).getTime();
    const endMs = new Date(ev.endAt).getTime();
    const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60_000));
    const recurrenceRule = parseRecurrenceRule(ev.recurrenceRuleJson);
    const reminderRules = parseReminderRules(ev.remindersJson, defaultReminderMinutes);
    const owner = userMap.get(Number(ev.ownerUserId));
    const unit = ev.organizationUnitId ? unitMap.get(Number(ev.organizationUnitId)) : undefined;

    return {
      id: Number(ev.id),
      code: ev.code,
      title: ev.title,
      description: ev.description ?? null,
      eventType: ev.eventType,
      status: ev.status,
      statusName: getCalendarEventStatusName(ev.status),
      visibility: ev.visibility,
      startAt: new Date(ev.startAt).toISOString(),
      endAt: new Date(ev.endAt).toISOString(),
      durationMinutes,
      timezone: ev.timezone || 'Asia/Ho_Chi_Minh',
      isAllDay: Boolean(ev.isAllDay),
      location: ev.location ?? null,
      meetingUrl: ev.meetingUrl ?? null,
      resourceCode: ev.resourceCode ?? null,
      resourceName: ev.resourceName ?? null,
      ownerUserId: Number(ev.ownerUserId),
      ownerFullName: owner?.fullName ?? null,
      organizationUnitId: ev.organizationUnitId ?? null,
      organizationUnitName: unit?.name ?? null,
      isRecurring: recurrenceRule !== null,
      recurrenceRule,
      reminderRules,
      externalBindings: parseExternalBindings(ev.externalBindingsJson),
      participantCount: partCountByEvent.get(Number(ev.id)) ?? 0,
      cancelReason: ev.cancelReason ?? null,
      version: Number(ev.version ?? 1),
      createdAt: ev.createdAt ? new Date(ev.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: ev.updatedAt ? new Date(ev.updatedAt).toISOString() : new Date().toISOString(),
    };
  });
}

export async function hydrateCalendarEventDetail(params: {
  event: CalendarEventEntity;
  participants: readonly CalendarEventParticipantEntity[];
  reminders: readonly CalendarEventReminderEntity[];
  histories: readonly CalendarEventHistoryEntity[];
  viewerAccess: CalendarEventAccessEvaluation;
  usersPublicService?: IUsersPublicService | null | undefined;
  organizationsPublicService?: IOrganizationsPublicService | null | undefined;
  defaultReminderMinutes?: number | undefined;
  maxOccurrences?: number | undefined;
}): Promise<CalendarEventDetailView> {
  const {
    event,
    participants,
    reminders,
    histories,
    viewerAccess,
    usersPublicService,
    organizationsPublicService,
    defaultReminderMinutes = 15,
    maxOccurrences = 12,
  } = params;

  const [baseItem] = await hydrateCalendarEventsList({
    events: [event],
    participants,
    usersPublicService,
    organizationsPublicService,
    defaultReminderMinutes,
  });

  const userIds = new Set<number>();
  const unitIds = new Set<number>();
  for (const p of participants) {
    if (p.userId) userIds.add(Number(p.userId));
    if (p.organizationUnitId) unitIds.add(Number(p.organizationUnitId));
  }
  for (const h of histories) {
    if (h.actorUserId) userIds.add(Number(h.actorUserId));
  }

  const [contacts, units] = await Promise.all([
    userIds.size > 0 && usersPublicService?.findUserContactsByIds
      ? usersPublicService.findUserContactsByIds([...userIds]).catch(() => [])
      : Promise.resolve([]),
    unitIds.size > 0 && organizationsPublicService
      ? organizationsPublicService.findByIds([...unitIds]).catch(() => [])
      : Promise.resolve([]),
  ]);

  const userMap = new Map(contacts.map((u) => [Number(u.id), u]));
  const unitMap = new Map(units.map((u) => [Number(u.id), u]));

  const participantViews: CalendarEventParticipantItemView[] = participants.map((p) => {
    const u = p.userId ? userMap.get(Number(p.userId)) : undefined;
    const org = p.organizationUnitId ? unitMap.get(Number(p.organizationUnitId)) : undefined;
    return {
      id: Number(p.id),
      calendarEventId: Number(p.calendarEventId),
      participantType: p.participantType,
      userId: p.userId ?? null,
      userFullName: u?.fullName ?? null,
      username: u?.username ?? null,
      organizationUnitId: p.organizationUnitId ?? null,
      organizationUnitCode: org?.code ?? null,
      organizationUnitName: org?.name ?? null,
      role: p.participantRole,
      canEdit: Boolean(p.canEdit),
      rsvpStatus: p.rsvpStatus,
      responseNote: p.responseNote ?? null,
      respondedAt: p.respondedAt ? new Date(p.respondedAt).toISOString() : null,
      addedByUserId: p.addedByUserId ?? null,
      createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
    };
  });

  const reminderViews: CalendarEventReminderItemView[] = reminders.map((r) => ({
    id: Number(r.id),
    calendarEventId: Number(r.calendarEventId),
    occurrenceStartAt: new Date(r.occurrenceStartAt).toISOString(),
    minutesBefore: Number(r.minutesBefore),
    remindAt: new Date(r.remindAt).toISOString(),
    channels: safeJsonParseStringArray(r.channelsJson),
    status: r.status,
    notificationId: r.notificationId ?? null,
    recipientCount: Number(r.recipientCount ?? 0),
    sentAt: r.sentAt ? new Date(r.sentAt).toISOString() : null,
    errorMessage: r.errorMessage ?? null,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  }));

  const historyViews: CalendarEventHistoryItemView[] = histories.map((h) => {
    const actor = h.actorUserId ? userMap.get(Number(h.actorUserId)) : undefined;
    return {
      id: Number(h.id),
      calendarEventId: Number(h.calendarEventId),
      actionType: h.actionType,
      changeSource: h.changeSource,
      actorUserId: h.actorUserId ?? null,
      actorFullName: actor?.fullName ?? null,
      changedFields: safeJsonParseStringArray(h.changedFieldsJson),
      beforeSnapshot: h.beforeSnapshotJson
        ? safeJsonParseObject<Record<string, unknown>>(h.beforeSnapshotJson)
        : null,
      afterSnapshot: h.afterSnapshotJson
        ? safeJsonParseObject<Record<string, unknown>>(h.afterSnapshotJson)
        : null,
      reason: h.reason ?? null,
      metadata: h.metadataJson
        ? safeJsonParseObject<Record<string, unknown>>(h.metadataJson)
        : null,
      createdAt: h.createdAt ? new Date(h.createdAt).toISOString() : new Date().toISOString(),
    };
  });

  const upcomingOccurrences = expandEventOccurrences({
    event,
    maxOccurrences,
  });

  return {
    ...baseItem!,
    participants: participantViews,
    upcomingOccurrences,
    reminders: reminderViews,
    histories: historyViews,
    viewerAccess,
    metadata: event.metadataJson
      ? safeJsonParseObject<Record<string, unknown>>(event.metadataJson)
      : null,
  };
}
