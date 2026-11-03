import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import {
  HTTP_STATUS_CODE,
  defaultCodeRegistry,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
  SequenceRegistryService,
} from '@packages/kernel/index.js';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { actingAs } from '../../../concerns/permission.concern.js';
import { USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import { ORGANIZATIONS_PUBLIC_SERVICE } from '@modules/organizations/contracts/index.js';
import { NOTIFICATIONS_PUBLIC_SERVICE } from '@modules/notifications/contracts/index.js';
import {
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_EVENT_STATUS,
  CALENDAR_EVENT_TYPE,
  CALENDAR_HISTORY_ACTION_TYPE,
  CALENDAR_PARTICIPANT_ROLE,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_RECURRENCE_FREQUENCY,
  CALENDAR_REMINDER_STATUS,
  CALENDAR_RSVP_STATUS,
  CALENDAR_VISIBILITY,
} from '@modules/calendar/index.js';
import type { CalendarEventEntity } from '@modules/calendar/entities/calendar-event.entity.js';
import type { CalendarEventParticipantEntity } from '@modules/calendar/entities/calendar-event-participant.entity.js';
import type { CalendarEventReminderEntity } from '@modules/calendar/entities/calendar-event-reminder.entity.js';
import type { CalendarEventHistoryEntity } from '@modules/calendar/entities/calendar-event-history.entity.js';
import {
  CalendarEventRepository,
  type SearchCalendarEventsFilter,
} from '@modules/calendar/repositories/calendar-event.repository.js';
import {
  CalendarEventParticipantRepository,
  type UpsertCalendarParticipantInput,
} from '@modules/calendar/repositories/calendar-event-participant.repository.js';
import {
  CalendarEventReminderRepository,
  type CreateCalendarReminderInput,
} from '@modules/calendar/repositories/calendar-event-reminder.repository.js';
import {
  CalendarEventHistoryRepository,
  type RecordCalendarEventHistoryInput,
} from '@modules/calendar/repositories/calendar-event-history.repository.js';

describe('Feature E2E: Calendar & Event Module (/api/v1/calendar — Section 9.7)', () => {
  let context: TestAppContext;

  let eventSeq = 1;
  let partSeq = 1;
  let remSeq = 1;
  let histSeq = 1;

  const eventStore = new Map<number, CalendarEventEntity>();
  const participantStore = new Map<number, CalendarEventParticipantEntity>();
  const reminderStore = new Map<number, CalendarEventReminderEntity>();
  const historyStore = new Map<number, CalendarEventHistoryEntity>();
  const dispatchedNotifications: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    defaultCodeRegistry.seedDefaults();
    defaultSettingRegistry.bootstrapFromManifests();
    defaultFeatureFlagRegistry.bootstrapFromManifests();

    context = await createTestApp({
      useGlobalPrefix: true,
    });

    const sequenceRegistry = context.moduleFixture.get(SequenceRegistryService, { strict: false });
    sequenceRegistry.registerManifestSequences();

    const eventRepo = context.moduleFixture.get(CalendarEventRepository, { strict: false });
    Object.assign(eventRepo, {
      findById: async (id: number) => eventStore.get(Number(id)) ?? null,
      findByIds: async (ids: readonly number[]) =>
        ids
          .map((i) => eventStore.get(Number(i)))
          .filter((x): x is CalendarEventEntity => Boolean(x)),
      findByCode: async (code: string) =>
        [...eventStore.values()].find((e) => e.code.toUpperCase() === code.trim().toUpperCase()) ??
        null,
      findActiveEventsForConflictOrRange: async (params?: { excludeEventId?: number }) =>
        [...eventStore.values()].filter(
          (e) =>
            e.status !== CALENDAR_EVENT_STATUS.CANCELLED &&
            (!params?.excludeEventId || Number(e.id) !== Number(params.excludeEventId)),
        ),
      searchPaginated: async (filter: SearchCalendarEventsFilter = {}) => {
        let list = [...eventStore.values()];
        if (filter.eventType) {
          list = list.filter((e) => e.eventType.toUpperCase() === filter.eventType!.toUpperCase());
        }
        if (filter.status !== undefined) {
          list = list.filter((e) => e.status === filter.status);
        }
        if (filter.resourceCode) {
          list = list.filter(
            (e) => (e.resourceCode ?? '').toUpperCase() === filter.resourceCode!.toUpperCase(),
          );
        }
        return { items: list, total: list.length };
      },
      saveEntity: async (data: Partial<CalendarEventEntity>) => {
        const id = data.id ? Number(data.id) : eventSeq++;
        const existing = eventStore.get(id);
        const saved = {
          ...existing,
          ...data,
          id,
          version: existing ? Number(existing.version ?? 1) + 1 : 1,
          createdAt: existing?.createdAt ?? new Date(),
          updatedAt: new Date(),
        } as CalendarEventEntity;
        eventStore.set(id, saved);
        return saved;
      },
    });

    const participantRepo = context.moduleFixture.get(CalendarEventParticipantRepository, {
      strict: false,
    });
    Object.assign(participantRepo, {
      findById: async (id: number) => participantStore.get(Number(id)) ?? null,
      findByEventId: async (calendarEventId: number) =>
        [...participantStore.values()].filter(
          (p) => Number(p.calendarEventId) === Number(calendarEventId),
        ),
      findByEventIds: async (calendarEventIds: readonly number[]) => {
        const set = new Set(calendarEventIds.map((i) => Number(i)));
        return [...participantStore.values()].filter((p) => set.has(Number(p.calendarEventId)));
      },
      replaceParticipantsForEvent: async (
        calendarEventId: number,
        items: readonly UpsertCalendarParticipantInput[],
        addedByUserId?: number | null,
      ) => {
        for (const [k, v] of participantStore.entries()) {
          if (Number(v.calendarEventId) === Number(calendarEventId)) {
            participantStore.delete(k);
          }
        }
        const created: CalendarEventParticipantEntity[] = [];
        for (const item of items) {
          const id = partSeq++;
          const entity = {
            id,
            calendarEventId: Number(calendarEventId),
            participantType: item.participantType,
            userId: item.userId ?? null,
            organizationUnitId: item.organizationUnitId ?? null,
            participantRole: item.role ?? CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
            canEdit: Boolean(item.canEdit || item.role === CALENDAR_PARTICIPANT_ROLE.ORGANIZER),
            rsvpStatus: item.rsvpStatus ?? CALENDAR_RSVP_STATUS.PENDING,
            responseNote: item.responseNote ?? null,
            respondedAt: null,
            addedByUserId: addedByUserId ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as CalendarEventParticipantEntity;
          participantStore.set(id, entity);
          created.push(entity);
        }
        return created;
      },
      saveEntity: async (data: Partial<CalendarEventParticipantEntity>) => {
        const id = data.id ? Number(data.id) : partSeq++;
        const existing = participantStore.get(id);
        const saved = {
          ...existing,
          ...data,
          id,
          createdAt: existing?.createdAt ?? new Date(),
          updatedAt: new Date(),
        } as CalendarEventParticipantEntity;
        participantStore.set(id, saved);
        return saved;
      },
      deleteById: async (id: number) => {
        participantStore.delete(Number(id));
      },
    });

    const reminderRepo = context.moduleFixture.get(CalendarEventReminderRepository, {
      strict: false,
    });
    Object.assign(reminderRepo, {
      findByEventId: async (calendarEventId: number) =>
        [...reminderStore.values()].filter(
          (r) => Number(r.calendarEventId) === Number(calendarEventId),
        ),
      findByEventIds: async (calendarEventIds: readonly number[]) => {
        const set = new Set(calendarEventIds.map((i) => Number(i)));
        return [...reminderStore.values()].filter((r) => set.has(Number(r.calendarEventId)));
      },
      findDuePendingReminders: async (now: Date) =>
        [...reminderStore.values()].filter(
          (r) =>
            r.status === CALENDAR_REMINDER_STATUS.PENDING &&
            new Date(r.remindAt).getTime() <= now.getTime(),
        ),
      replacePendingRemindersForEvent: async (
        calendarEventId: number,
        inputs: readonly CreateCalendarReminderInput[],
      ) => {
        for (const [k, v] of reminderStore.entries()) {
          if (
            Number(v.calendarEventId) === Number(calendarEventId) &&
            v.status === CALENDAR_REMINDER_STATUS.PENDING
          ) {
            reminderStore.delete(k);
          }
        }
        const created: CalendarEventReminderEntity[] = [];
        for (const item of inputs) {
          const id = remSeq++;
          const entity = {
            id,
            calendarEventId: Number(item.calendarEventId),
            occurrenceStartAt: item.occurrenceStartAt,
            minutesBefore: item.minutesBefore,
            remindAt: item.remindAt,
            channelsJson: JSON.stringify(item.channels),
            status: CALENDAR_REMINDER_STATUS.PENDING,
            notificationId: null,
            recipientCount: 0,
            sentAt: null,
            errorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as CalendarEventReminderEntity;
          reminderStore.set(id, entity);
          created.push(entity);
        }
        return created;
      },
      cancelPendingRemindersForEvent: async (calendarEventId: number) => {
        for (const r of reminderStore.values()) {
          if (
            Number(r.calendarEventId) === Number(calendarEventId) &&
            r.status === CALENDAR_REMINDER_STATUS.PENDING
          ) {
            r.status = CALENDAR_REMINDER_STATUS.SKIPPED;
          }
        }
      },
      saveEntity: async (data: Partial<CalendarEventReminderEntity>) => {
        const id = data.id ? Number(data.id) : remSeq++;
        const existing = reminderStore.get(id);
        const saved = {
          ...existing,
          ...data,
          id,
        } as CalendarEventReminderEntity;
        reminderStore.set(id, saved);
        return saved;
      },
    });

    const historyRepo = context.moduleFixture.get(CalendarEventHistoryRepository, {
      strict: false,
    });
    Object.assign(historyRepo, {
      findByEventId: async (calendarEventId: number) =>
        [...historyStore.values()].filter(
          (h) => Number(h.calendarEventId) === Number(calendarEventId),
        ),
      recordHistory: async (input: RecordCalendarEventHistoryInput) => {
        const id = histSeq++;
        const entity = {
          id,
          calendarEventId: Number(input.calendarEventId),
          actionType: input.actionType ?? CALENDAR_HISTORY_ACTION_TYPE.UPDATED,
          changeSource: input.changeSource ?? CALENDAR_CHANGE_SOURCE.WEB_UI,
          actorUserId: input.actorUserId ?? null,
          changedFieldsJson: input.changedFields ? JSON.stringify(input.changedFields) : null,
          beforeSnapshotJson: input.beforeSnapshot ? JSON.stringify(input.beforeSnapshot) : null,
          afterSnapshotJson: input.afterSnapshot ? JSON.stringify(input.afterSnapshot) : null,
          reason: input.reason ?? null,
          metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as CalendarEventHistoryEntity;
        historyStore.set(id, entity);
        return entity;
      },
    });

    const usersPublic = context.moduleFixture.get<Record<string, unknown>>(USERS_PUBLIC_SERVICE, {
      strict: false,
    });
    Object.assign(usersPublic, {
      findAuthUserById: async (userId: number) => ({
        id: Number(userId),
        username: `user_${userId}`,
        fullName: `Người dùng #${userId}`,
        managerId: Number(userId) === 10 ? 9 : 1,
        effectiveManagerId: Number(userId) === 10 ? 9 : 1,
        primaryOrganizationUnitId: 3,
        organizationUnitIds: [3],
      }),
      findUserContactsByIds: async (userIds: readonly number[]) =>
        userIds.map((uid) => ({
          id: Number(uid),
          username: `user_${uid}`,
          email: `user_${uid}@example.com`,
          phone: null,
          fullName: `Người dùng #${uid}`,
          preferredLocale: 'vi',
          preferredTimezone: 'Asia/Ho_Chi_Minh',
          primaryOrganizationUnitId: 3,
        })),
      findActiveUserIdsByOrganizationUnitIds: async (unitIds: readonly number[]) =>
        unitIds.includes(3) ? [10, 20] : [],
      resolveApproverChain: async () => [],
      resolveSubordinateUserIds: async (managerId: number) => (managerId === 9 ? [10] : []),
    });

    const orgsPublic = context.moduleFixture.get<Record<string, unknown>>(
      ORGANIZATIONS_PUBLIC_SERVICE,
      { strict: false },
    );
    Object.assign(orgsPublic, {
      findByIds: async (ids: readonly number[]) =>
        ids.map((id) => ({
          id: Number(id),
          code: `UNIT_${id}`,
          name: `Đơn vị #${id}`,
          type: 3,
          typeName: 'DEPARTMENT',
          parentId: 2,
          managerId: 9,
          status: 1,
          statusName: 'ACTIVE',
        })),
      resolveDescendantUnitIds: async (rootIds: readonly number[]) => [...rootIds],
    });

    const notificationsPublic = context.moduleFixture.get<Record<string, unknown>>(
      NOTIFICATIONS_PUBLIC_SERVICE,
      { strict: false },
    );
    Object.assign(notificationsPublic, {
      dispatch: async (input: Record<string, unknown>) => {
        dispatchedNotifications.push(input);
        const userIds = Array.isArray(input.userIds) ? input.userIds : [input.userId];
        return { id: 900 + dispatchedNotifications.length, recipientCount: userIds.length };
      },
    });
  });

  afterAll(async () => {
    await context.close();
  });

  it('POST /api/v1/calendar/events — creates recurring event with participants, reminders, external sync, and full HTTP lifecycle', async () => {
    const ownerSession = actingAs(context.app, {
      id: 10,
      email: 'owner10@enterprise.vn',
      roles: ['staff'],
      permissions: [
        'calendar.read',
        'calendar.create',
        'calendar.update',
        'calendar.delete',
        'calendar.sync',
      ],
    });

    // 1. Create event with startAt, endAt, recurrence, participants (User + OrgUnit), reminders & Google sync
    const createRes = await context.injectJson<{
      id: number;
      code: string;
      title: string;
      participants: Array<{ id: number; participantType: string; rsvpStatus: string }>;
      reminders: Array<{ id: number; status: string }>;
      externalBindings: Record<string, { externalEventId: string }>;
    }>({
      method: 'POST',
      url: '/api/v1/calendar/events',
      headers: ownerSession.headers,
      payload: {
        title: 'Họp Giao ban Kỹ thuật Hàng tuần',
        description: 'Kiểm điểm tiến độ sprint và kiến trúc hệ thống',
        eventType: CALENDAR_EVENT_TYPE.MEETING,
        visibility: CALENDAR_VISIBILITY.PUBLIC,
        startAt: '2026-11-02T09:00:00.000Z',
        endAt: '2026-11-02T10:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        isAllDay: false,
        location: 'Phòng họp B2',
        resourceCode: 'ROOM_HCM_B2',
        recurrenceRule: {
          frequency: CALENDAR_RECURRENCE_FREQUENCY.WEEKLY,
          interval: 1,
          byWeekDays: [1],
          count: 3,
        },
        reminderRules: [{ minutesBefore: 15, channels: ['IN_APP'] }],
        participants: [
          {
            participantType: CALENDAR_PARTICIPANT_TYPE.USER,
            userId: 15,
            role: CALENDAR_PARTICIPANT_ROLE.REQUIRED,
            canEdit: false,
          },
          {
            participantType: CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT,
            organizationUnitId: 3,
            role: CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
            canEdit: false,
          },
        ],
        syncProviders: ['GOOGLE'],
      },
    });

    expect(createRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(createRes.body.success).toBe(true);
    const eventId = createRes.body.data.id;
    expect(eventId).toBeGreaterThan(0);
    expect(createRes.body.data.code).toMatch(/^EVT-\d{6}-\d{6}$/);
    expect(createRes.body.data.participants).toHaveLength(2);
    expect(createRes.body.data.externalBindings.GOOGLE?.externalEventId).toContain('gcal_');

    // 2. GET /api/v1/calendar/occurrences — expands 3 weekly occurrences
    const occRes = await context.injectJson<Array<{ occurrenceIndex: number }>>({
      method: 'GET',
      url: '/api/v1/calendar/occurrences?fromDate=2026-11-01T00:00:00.000Z&toDate=2026-11-30T23:59:59.000Z',
      headers: ownerSession.headers,
    });
    expect(occRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(occRes.body.data.length).toBe(3);

    // 3. POST /api/v1/calendar/conflicts/check — detects conflict on second weekly occurrence
    const conflictRes = await context.injectJson<{
      hasConflict: boolean;
      resourceConflictCount: number;
      participantConflictCount: number;
    }>({
      method: 'POST',
      url: '/api/v1/calendar/conflicts/check',
      headers: ownerSession.headers,
      payload: {
        startAt: '2026-11-09T09:15:00.000Z',
        endAt: '2026-11-09T09:45:00.000Z',
        resourceCode: 'ROOM_HCM_B2',
        participantUserIds: [15],
      },
    });
    expect(conflictRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(conflictRes.body.data.hasConflict).toBe(true);
    expect(conflictRes.body.data.resourceConflictCount).toBeGreaterThanOrEqual(1);
    expect(conflictRes.body.data.participantConflictCount).toBeGreaterThanOrEqual(1);

    // 4. POST /api/v1/calendar/events/:id/rsvp — Participant #15 accepts invitation
    const participantSession = actingAs(context.app, {
      id: 15,
      email: 'user15@enterprise.vn',
      roles: ['staff'],
      permissions: ['calendar.read'],
    });
    const rsvpRes = await context.injectJson<{
      participants: Array<{ userId: number | null; rsvpStatus: string }>;
    }>({
      method: 'POST',
      url: `/api/v1/calendar/events/${eventId}/rsvp`,
      headers: participantSession.headers,
      payload: {
        rsvpStatus: CALENDAR_RSVP_STATUS.ACCEPTED,
        responseNote: 'Xác nhận tham dự',
      },
    });
    expect(rsvpRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(rsvpRes.body.data.participants.find((p) => p.userId === 15)?.rsvpStatus).toBe(
      CALENDAR_RSVP_STATUS.ACCEPTED,
    );

    // 5. POST /api/v1/calendar/events/:id/sync — Outbound sync to Microsoft Calendar
    const syncRes = await context.injectJson<{
      syncedProviders: string[];
      bindings: Record<string, { externalEventId: string }>;
    }>({
      method: 'POST',
      url: `/api/v1/calendar/events/${eventId}/sync`,
      headers: ownerSession.headers,
      payload: {
        providers: ['MICROSOFT'],
      },
    });
    expect(syncRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(syncRes.body.data.syncedProviders).toContain('MICROSOFT');
    expect(syncRes.body.data.bindings.MICROSOFT?.externalEventId).toContain('msgraph_');

    // 6. POST /api/v1/calendar/integrations/MICROSOFT/inbound-sync — Inbound webhook update
    const inboundRes = await context.injectJson<{ title: string }>({
      method: 'POST',
      url: '/api/v1/calendar/integrations/MICROSOFT/inbound-sync',
      headers: ownerSession.headers,
      payload: {
        eventId,
        externalEventId: syncRes.body.data.bindings.MICROSOFT!.externalEventId,
        title: 'Họp Giao ban Kỹ thuật Hàng tuần (Đồng bộ từ Outlook)',
      },
    });
    expect(inboundRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(inboundRes.body.data.title).toContain('Đồng bộ từ Outlook');

    // 7. POST /api/v1/calendar/reminders/scan — Dispatches due reminders via NotificationsService
    const adminSession = actingAs(context.app, {
      id: 1,
      email: 'admin@enterprise.vn',
      roles: ['admin'],
      permissions: ['calendar.manage', 'calendar.read'],
    });
    const scanRes = await context.injectJson<{
      dueReminderCount: number;
      dispatchedCount: number;
    }>({
      method: 'POST',
      url: '/api/v1/calendar/reminders/scan',
      headers: adminSession.headers,
      payload: {
        now: '2026-11-02T08:50:00.000Z',
      },
    });
    expect(scanRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(scanRes.body.data.dueReminderCount).toBeGreaterThanOrEqual(1);
    expect(scanRes.body.data.dispatchedCount).toBeGreaterThanOrEqual(1);

    // 8. GET /api/v1/calendar/events/:id/histories — Verifies audit trail with change sources
    const histRes = await context.injectJson<Array<{ actionType: string; changeSource: string }>>({
      method: 'GET',
      url: `/api/v1/calendar/events/${eventId}/histories`,
      headers: ownerSession.headers,
    });
    expect(histRes.status).toBe(HTTP_STATUS_CODE.OK);
    const sources = histRes.body.data.map((h) => h.changeSource);
    expect(sources).toEqual(expect.arrayContaining(['WEB_UI', 'MICROSOFT_SYNC', 'SCHEDULER']));
  });
});
