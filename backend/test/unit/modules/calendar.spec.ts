import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  SequenceRegistryService,
  defaultCodeRegistry,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import type { IOrganizationsPublicService } from '@modules/organizations/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import type { INotificationsPublicService } from '@modules/notifications/contracts/index.js';
import {
  CALENDAR_ACCESS_ROLE,
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_CONFLICT_TYPE,
  CALENDAR_EVENT_STATUS,
  CALENDAR_EVENT_TYPE,
  CALENDAR_EXTERNAL_PROVIDER,
  CALENDAR_HISTORY_ACTION_TYPE,
  CALENDAR_PARTICIPANT_ROLE,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_RECURRENCE_FREQUENCY,
  CALENDAR_REMINDER_STATUS,
  CALENDAR_RSVP_STATUS,
  CALENDAR_VISIBILITY,
  CalendarService,
  expandEventOccurrences,
  validateRecurrenceRule,
} from '../../../src/modules/calendar/index.js';
import type { CalendarEventEntity } from '../../../src/modules/calendar/entities/calendar-event.entity.js';
import type { CalendarEventParticipantEntity } from '../../../src/modules/calendar/entities/calendar-event-participant.entity.js';
import type { CalendarEventReminderEntity } from '../../../src/modules/calendar/entities/calendar-event-reminder.entity.js';
import type { CalendarEventHistoryEntity } from '../../../src/modules/calendar/entities/calendar-event-history.entity.js';
import type {
  CalendarEventRepository,
  SearchCalendarEventsFilter,
} from '../../../src/modules/calendar/repositories/calendar-event.repository.js';
import type {
  CalendarEventParticipantRepository,
  UpsertCalendarParticipantInput,
} from '../../../src/modules/calendar/repositories/calendar-event-participant.repository.js';
import type {
  CalendarEventReminderRepository,
  CreateCalendarReminderInput,
} from '../../../src/modules/calendar/repositories/calendar-event-reminder.repository.js';
import type {
  CalendarEventHistoryRepository,
  RecordCalendarEventHistoryInput,
} from '../../../src/modules/calendar/repositories/calendar-event-history.repository.js';

function createInMemoryCalendarHarness() {
  defaultCodeRegistry.seedDefaults();
  defaultSettingRegistry.bootstrapFromManifests();
  defaultFeatureFlagRegistry.bootstrapFromManifests();
  const sequenceRegistry = new SequenceRegistryService();
  sequenceRegistry.registerManifestSequences();

  let eventSeq = 1;
  let partSeq = 1;
  let remSeq = 1;
  let histSeq = 1;

  const events = new Map<number, CalendarEventEntity>();
  const participants = new Map<number, CalendarEventParticipantEntity>();
  const reminders = new Map<number, CalendarEventReminderEntity>();
  const histories = new Map<number, CalendarEventHistoryEntity>();
  const dispatchedNotifications: Array<Record<string, unknown>> = [];

  const eventRepository = {
    findById: async (id: number) => events.get(Number(id)) ?? null,
    findByIds: async (ids: readonly number[]) =>
      ids.map((i) => events.get(Number(i))).filter((x): x is CalendarEventEntity => Boolean(x)),
    findByCode: async (code: string) =>
      [...events.values()].find((e) => e.code.toUpperCase() === code.trim().toUpperCase()) ?? null,
    findActiveEventsForConflictOrRange: async (params?: { excludeEventId?: number }) =>
      [...events.values()].filter(
        (e) =>
          e.status !== CALENDAR_EVENT_STATUS.CANCELLED &&
          (!params?.excludeEventId || Number(e.id) !== Number(params.excludeEventId)),
      ),
    searchPaginated: async (filter: SearchCalendarEventsFilter = {}) => {
      let list = [...events.values()];
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
      const existing = events.get(id);
      const saved = {
        ...existing,
        ...data,
        id,
        version: existing ? Number(existing.version ?? 1) + 1 : 1,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      } as CalendarEventEntity;
      events.set(id, saved);
      return saved;
    },
  } as unknown as CalendarEventRepository;

  const participantRepository = {
    findById: async (id: number) => participants.get(Number(id)) ?? null,
    findByEventId: async (calendarEventId: number) =>
      [...participants.values()].filter(
        (p) => Number(p.calendarEventId) === Number(calendarEventId),
      ),
    findByEventIds: async (calendarEventIds: readonly number[]) => {
      const set = new Set(calendarEventIds.map((i) => Number(i)));
      return [...participants.values()].filter((p) => set.has(Number(p.calendarEventId)));
    },
    replaceParticipantsForEvent: async (
      calendarEventId: number,
      items: readonly UpsertCalendarParticipantInput[],
      addedByUserId?: number | null,
    ) => {
      for (const [k, v] of participants.entries()) {
        if (Number(v.calendarEventId) === Number(calendarEventId)) {
          participants.delete(k);
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
        participants.set(id, entity);
        created.push(entity);
      }
      return created;
    },
    saveEntity: async (data: Partial<CalendarEventParticipantEntity>) => {
      const id = data.id ? Number(data.id) : partSeq++;
      const existing = participants.get(id);
      const saved = {
        ...existing,
        ...data,
        id,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      } as CalendarEventParticipantEntity;
      participants.set(id, saved);
      return saved;
    },
    deleteById: async (id: number) => {
      participants.delete(Number(id));
    },
  } as unknown as CalendarEventParticipantRepository;

  const reminderRepository = {
    findByEventId: async (calendarEventId: number) =>
      [...reminders.values()].filter((r) => Number(r.calendarEventId) === Number(calendarEventId)),
    findByEventIds: async (calendarEventIds: readonly number[]) => {
      const set = new Set(calendarEventIds.map((i) => Number(i)));
      return [...reminders.values()].filter((r) => set.has(Number(r.calendarEventId)));
    },
    findDuePendingReminders: async (now: Date) =>
      [...reminders.values()].filter(
        (r) =>
          r.status === CALENDAR_REMINDER_STATUS.PENDING &&
          new Date(r.remindAt).getTime() <= now.getTime(),
      ),
    replacePendingRemindersForEvent: async (
      calendarEventId: number,
      inputs: readonly CreateCalendarReminderInput[],
    ) => {
      for (const [k, v] of reminders.entries()) {
        if (
          Number(v.calendarEventId) === Number(calendarEventId) &&
          v.status === CALENDAR_REMINDER_STATUS.PENDING
        ) {
          reminders.delete(k);
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
        reminders.set(id, entity);
        created.push(entity);
      }
      return created;
    },
    cancelPendingRemindersForEvent: async (calendarEventId: number) => {
      for (const r of reminders.values()) {
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
      const existing = reminders.get(id);
      const saved = {
        ...existing,
        ...data,
        id,
      } as CalendarEventReminderEntity;
      reminders.set(id, saved);
      return saved;
    },
  } as unknown as CalendarEventReminderRepository;

  const historyRepository = {
    findByEventId: async (calendarEventId: number) =>
      [...histories.values()].filter((h) => Number(h.calendarEventId) === Number(calendarEventId)),
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
      histories.set(id, entity);
      return entity;
    },
  } as unknown as CalendarEventHistoryRepository;

  const usersPublicService = {
    findAuthUserById: async (userId: number) => {
      if (userId === 10) {
        return {
          id: 10,
          username: 'emp10',
          fullName: 'Nhân viên 10',
          managerId: 9,
          effectiveManagerId: 9,
          primaryOrganizationUnitId: 3,
          organizationUnitIds: [3],
        };
      }
      if (userId === 20) {
        return {
          id: 20,
          username: 'emp20',
          fullName: 'Nhân viên 20 (Phòng Kỹ thuật)',
          managerId: 10,
          effectiveManagerId: 10,
          primaryOrganizationUnitId: 3,
          organizationUnitIds: [3],
        };
      }
      return {
        id: userId,
        username: `user${userId}`,
        fullName: `User #${userId}`,
        managerId: 1,
        effectiveManagerId: 1,
        primaryOrganizationUnitId: 2,
        organizationUnitIds: [2],
      };
    },
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
    findActiveUserIdsByOrganizationUnitIds: async (unitIds: readonly number[]) => {
      if (unitIds.includes(3)) return [10, 20, 21];
      return [];
    },
    resolveApproverChain: async (userId: number) => {
      if (userId === 10) {
        return [
          {
            step: 1,
            userId: 9,
            username: 'director_hcm',
            fullName: 'Giám đốc Chi nhánh',
            email: 'director@example.com',
            status: 1,
            primaryOrganizationUnitId: 2,
            positionTitle: 'Director',
            sourceType: 'DIRECT_MANAGER' as const,
          },
        ];
      }
      return [];
    },
    resolveSubordinateUserIds: async (managerId: number) => {
      if (managerId === 9) return [10, 20];
      return [];
    },
  } as unknown as IUsersPublicService;

  const organizationsPublicService = {
    findByIds: async (ids: readonly number[]) =>
      ids.map((id) => ({
        id: Number(id),
        code: `UNIT_${id}`,
        name: `Đơn vị #${id}`,
        type: 3,
        typeName: 'DEPARTMENT',
        parentId: 2,
        managerId: Number(id) === 3 ? 9 : 1,
        status: 1,
        statusName: 'ACTIVE',
      })),
    resolveDescendantUnitIds: async (rootUnitIds: readonly number[]) => [...rootUnitIds],
  } as unknown as IOrganizationsPublicService;

  const notificationsPublicService = {
    dispatch: async (input: Record<string, unknown>) => {
      dispatchedNotifications.push(input);
      const userIds = Array.isArray(input.userIds) ? input.userIds : [input.userId];
      return {
        id: 500 + dispatchedNotifications.length,
        recipientCount: userIds.length,
      };
    },
  } as unknown as INotificationsPublicService;

  const service = new CalendarService(
    eventRepository,
    participantRepository,
    reminderRepository,
    historyRepository,
    usersPublicService,
    organizationsPublicService,
    notificationsPublicService,
    null,
    null,
    sequenceRegistry,
  );

  return {
    service,
    events,
    participants,
    reminders,
    histories,
    dispatchedNotifications,
  };
}

describe('Calendar & Event Module Unit Tests (Section 9.7)', () => {
  describe('9.7.1 & 9.7.2 — Tạo sự kiện (startAt/endAt) và Thêm người tham gia (User / Đơn vị)', () => {
    it('creates an event with startAt/endAt, auto-generates EVT code, and attaches USER and ORGANIZATION_UNIT participants', async () => {
      const { service } = createInMemoryCalendarHarness();

      const created = await service.createEvent(
        {
          title: 'Họp triển khai Kiến trúc Lịch & Sự kiện 9.7',
          description: 'Thống nhất thiết kế DB và API cho module Calendar',
          eventType: CALENDAR_EVENT_TYPE.MEETING,
          visibility: CALENDAR_VISIBILITY.INTERNAL,
          startAt: '2026-11-10T09:00:00.000Z',
          endAt: '2026-11-10T10:30:00.000Z',
          timezone: 'Asia/Ho_Chi_Minh',
          isAllDay: false,
          location: 'Phòng họp A1',
          resourceCode: 'ROOM_HCM_A1',
          participants: [
            {
              participantType: CALENDAR_PARTICIPANT_TYPE.USER,
              userId: 15,
              role: CALENDAR_PARTICIPANT_ROLE.REQUIRED,
              canEdit: true,
            },
            {
              participantType: CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT,
              organizationUnitId: 3,
              role: CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
              canEdit: false,
            },
          ],
        },
        { id: 10, username: 'emp10', roles: ['staff'], permissions: ['calendar.create'] },
      );

      expect(created.id).toBeGreaterThan(0);
      expect(created.code).toMatch(/^EVT-\d{6}-\d{6}$/);
      expect(created.durationMinutes).toBe(90);
      expect(created.participants).toHaveLength(2);
      expect(created.participants[0]?.participantType).toBe('USER');
      expect(created.participants[0]?.userId).toBe(15);
      expect(created.participants[0]?.canEdit).toBe(true);
      expect(created.participants[1]?.participantType).toBe('ORGANIZATION_UNIT');
      expect(created.participants[1]?.organizationUnitId).toBe(3);
      expect(created.histories).toHaveLength(1);
      expect(created.histories[0]?.actionType).toBe(CALENDAR_HISTORY_ACTION_TYPE.CREATED);
    });

    it('rejects event creation when endAt is less than or equal to startAt', async () => {
      const { service } = createInMemoryCalendarHarness();

      await expect(
        service.createEvent({
          title: 'Sự kiện sai thời gian',
          eventType: CALENDAR_EVENT_TYPE.MEETING,
          visibility: CALENDAR_VISIBILITY.PUBLIC,
          startAt: '2026-11-10T11:00:00.000Z',
          endAt: '2026-11-10T10:00:00.000Z',
          timezone: 'Asia/Ho_Chi_Minh',
          isAllDay: false,
        }),
      ).rejects.toThrow(BadRequestAppException);
    });
  });

  describe('9.7.3 — Tạo sự kiện lặp lại (Ngày, tuần hoặc tháng)', () => {
    it('expands DAILY, WEEKLY, and MONTHLY recurring events accurately and respects exceptionDates', () => {
      const baseEvent = {
        id: 1,
        code: 'EVT-REC-001',
        title: 'Daily Standup',
        eventType: 'MEETING',
        status: CALENDAR_EVENT_STATUS.SCHEDULED,
        startAt: new Date('2026-11-02T02:00:00.000Z'),
        endAt: new Date('2026-11-02T02:30:00.000Z'),
        isAllDay: false,
        ownerUserId: 10,
        organizationUnitId: 3,
        recurrenceRuleJson: JSON.stringify({
          frequency: CALENDAR_RECURRENCE_FREQUENCY.DAILY,
          interval: 1,
          count: 4,
          exceptionDates: ['2026-11-03'],
        }),
      } as unknown as CalendarEventEntity;

      const dailyOccurrences = expandEventOccurrences({ event: baseEvent });
      expect(dailyOccurrences).toHaveLength(4);
      expect(dailyOccurrences.map((o) => o.startAt.slice(0, 10))).toEqual([
        '2026-11-02',
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
      ]);

      const weeklyEvent = {
        ...baseEvent,
        recurrenceRuleJson: JSON.stringify({
          frequency: CALENDAR_RECURRENCE_FREQUENCY.WEEKLY,
          interval: 1,
          byWeekDays: [1, 3], // Monday & Wednesday
          count: 3,
        }),
      } as unknown as CalendarEventEntity;
      const weeklyOccurrences = expandEventOccurrences({ event: weeklyEvent });
      expect(weeklyOccurrences).toHaveLength(3);
      expect(weeklyOccurrences.map((o) => o.startAt.slice(0, 10))).toEqual([
        '2026-11-02', // Mon
        '2026-11-04', // Wed
        '2026-11-09', // Next Mon
      ]);

      const monthlyEvent = {
        ...baseEvent,
        startAt: new Date('2026-01-31T08:00:00.000Z'),
        endAt: new Date('2026-01-31T09:00:00.000Z'),
        recurrenceRuleJson: JSON.stringify({
          frequency: CALENDAR_RECURRENCE_FREQUENCY.MONTHLY,
          interval: 1,
          byMonthDay: 31,
          count: 3,
        }),
      } as unknown as CalendarEventEntity;
      const monthlyOccurrences = expandEventOccurrences({ event: monthlyEvent });
      expect(monthlyOccurrences).toHaveLength(3);
      expect(monthlyOccurrences.map((o) => o.startAt.slice(0, 10))).toEqual([
        '2026-01-31',
        '2026-02-28', // Clamped to Feb end
        '2026-03-31',
      ]);
    });

    it('validates recurrence rules and rejects invalid until or count', () => {
      expect(() =>
        validateRecurrenceRule(
          {
            frequency: CALENDAR_RECURRENCE_FREQUENCY.DAILY,
            interval: 1,
            until: '2026-10-01T00:00:00.000Z',
          },
          new Date('2026-11-01T00:00:00.000Z'),
        ),
      ).toThrow(BadRequestAppException);
    });
  });

  describe('9.7.4 — Gửi nhắc lịch qua Notification và Scheduler', () => {
    it('scans due reminders, resolves both USER and ORGANIZATION_UNIT recipients, dispatches Notifications, and logs SCHEDULER history', async () => {
      const { service, dispatchedNotifications } = createInMemoryCalendarHarness();

      const event = await service.createEvent(
        {
          title: 'Họp Hội đồng Kiến trúc',
          eventType: CALENDAR_EVENT_TYPE.MEETING,
          visibility: CALENDAR_VISIBILITY.PUBLIC,
          startAt: '2026-11-20T10:00:00.000Z',
          endAt: '2026-11-20T11:00:00.000Z',
          timezone: 'Asia/Ho_Chi_Minh',
          isAllDay: false,
          reminderRules: [{ minutesBefore: 30, channels: ['IN_APP', 'EMAIL'] }],
          participants: [
            {
              participantType: CALENDAR_PARTICIPANT_TYPE.USER,
              userId: 15,
              role: CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
            },
            {
              participantType: CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT,
              organizationUnitId: 3,
              role: CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
            },
          ],
        },
        { id: 10, username: 'emp10', roles: [], permissions: [] },
      );

      expect(event.reminders).toHaveLength(1);
      expect(event.reminders[0]?.remindAt).toBe('2026-11-20T09:30:00.000Z');

      // Quét tại thời điểm 09:31 (đã đến hạn nhắc trước 30 phút)
      const scanRes = await service.scanAndDispatchReminders(new Date('2026-11-20T09:31:00.000Z'));
      expect(scanRes.dueReminderCount).toBe(1);
      expect(scanRes.dispatchedCount).toBe(1);
      expect(dispatchedNotifications).toHaveLength(1);

      // Owner(10) + User(15) + OrgUnit#3 members(10, 20, 21) => [10, 15, 20, 21] (4 users)
      const sentPayload = dispatchedNotifications[0]!;
      expect(sentPayload.userIds).toEqual(expect.arrayContaining([10, 15, 20, 21]));

      const updatedDetail = await service.getEventById(event.id, {
        id: 10,
        username: 'emp10',
        roles: [],
        permissions: [],
      });
      expect(updatedDetail.reminders[0]?.status).toBe(CALENDAR_REMINDER_STATUS.SENT);
      const schedulerHistory = updatedDetail.histories.find(
        (h) => h.changeSource === CALENDAR_CHANGE_SOURCE.SCHEDULER,
      );
      expect(schedulerHistory).toBeDefined();
      expect(schedulerHistory?.actionType).toBe(CALENDAR_HISTORY_ACTION_TYPE.REMINDER_SENT);
    });
  });

  describe('9.7.5 — Kiểm tra trùng lịch theo người tham gia hoặc tài nguyên', () => {
    it('detects both RESOURCE conflict and PARTICIPANT conflict (including recurring occurrences) and blocks when required', async () => {
      const { service } = createInMemoryCalendarHarness();

      await service.createEvent(
        {
          title: 'Họp Kỹ thuật định kỳ thứ Hai',
          eventType: CALENDAR_EVENT_TYPE.MEETING,
          visibility: CALENDAR_VISIBILITY.PUBLIC,
          startAt: '2026-11-02T09:00:00.000Z',
          endAt: '2026-11-02T10:30:00.000Z',
          timezone: 'Asia/Ho_Chi_Minh',
          isAllDay: false,
          resourceCode: 'ROOM_HCM_A1',
          recurrenceRule: {
            frequency: CALENDAR_RECURRENCE_FREQUENCY.WEEKLY,
            interval: 1,
            byWeekDays: [1],
            count: 4,
          },
          participants: [
            {
              participantType: CALENDAR_PARTICIPANT_TYPE.USER,
              userId: 15,
              role: CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
            },
          ],
        },
        { id: 10, username: 'emp10', roles: [], permissions: [] },
      );

      // Kiểm tra trùng lịch vào tuần kế tiếp (2026-11-09 09:30 -> 10:00) trên cùng phòng họp và người tham gia #15
      const conflictCheck = await service.checkConflicts({
        startAt: '2026-11-09T09:30:00.000Z',
        endAt: '2026-11-09T10:00:00.000Z',
        resourceCode: 'ROOM_HCM_A1',
        participantUserIds: [15],
      });

      expect(conflictCheck.hasConflict).toBe(true);
      expect(conflictCheck.resourceConflictCount).toBeGreaterThanOrEqual(1);
      expect(conflictCheck.participantConflictCount).toBeGreaterThanOrEqual(1);
      expect(conflictCheck.conflicts.map((c) => c.conflictType)).toEqual(
        expect.arrayContaining([
          CALENDAR_CONFLICT_TYPE.RESOURCE,
          CALENDAR_CONFLICT_TYPE.PARTICIPANT_USER,
        ]),
      );

      // Tạo sự kiện trùng phòng họp ROOM_HCM_A1 -> bị chặn tự động bởi ConflictAppException
      await expect(
        service.createEvent({
          title: 'Sự kiện đặt trùng phòng họp A1',
          eventType: CALENDAR_EVENT_TYPE.MEETING,
          visibility: CALENDAR_VISIBILITY.PUBLIC,
          startAt: '2026-11-09T09:30:00.000Z',
          endAt: '2026-11-09T10:15:00.000Z',
          timezone: 'Asia/Ho_Chi_Minh',
          isAllDay: false,
          resourceCode: 'ROOM_HCM_A1',
        }),
      ).rejects.toThrow(ConflictAppException);
    });
  });

  describe('9.7.6 — Phân quyền xem và sửa lịch (Owner, Participant hoặc Manager)', () => {
    it('enforces view/edit permissions for Owner, Participant (with/without canEdit), Manager (owner manager / org manager), and blocks unauthorized users', async () => {
      const { service } = createInMemoryCalendarHarness();

      // Owner = User #10, Manager của User #10 và Đơn vị #3 = User #9
      const privateEvent = await service.createEvent(
        {
          title: 'Họp Đánh giá Nhân sự Mật',
          eventType: CALENDAR_EVENT_TYPE.MEETING,
          visibility: CALENDAR_VISIBILITY.PRIVATE,
          startAt: '2026-11-25T14:00:00.000Z',
          endAt: '2026-11-25T15:00:00.000Z',
          timezone: 'Asia/Ho_Chi_Minh',
          isAllDay: false,
          organizationUnitId: 3,
          participants: [
            {
              participantType: CALENDAR_PARTICIPANT_TYPE.USER,
              userId: 15,
              role: CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
              canEdit: false,
            },
            {
              participantType: CALENDAR_PARTICIPANT_TYPE.USER,
              userId: 16,
              role: CALENDAR_PARTICIPANT_ROLE.ORGANIZER,
              canEdit: true,
            },
          ],
        },
        { id: 10, username: 'emp10', roles: ['staff'], permissions: ['calendar.create'] },
      );

      // 1. Người lạ (User #99) không thể xem sự kiện PRIVATE
      await expect(
        service.getEventById(privateEvent.id, {
          id: 99,
          username: 'outsider',
          roles: ['staff'],
          permissions: ['calendar.read'],
        }),
      ).rejects.toThrow(ForbiddenAppException);

      // 2. Participant thường (User #15, canEdit = false): Xem được + RSVP được, nhưng KHÔNG sửa được sự kiện
      const part15Access = await service.evaluateAccess(privateEvent.id, {
        id: 15,
        username: 'user15',
        roles: ['staff'],
        permissions: ['calendar.read'],
      });
      expect(part15Access.accessRole).toBe(CALENDAR_ACCESS_ROLE.PARTICIPANT);
      expect(part15Access.canView).toBe(true);
      expect(part15Access.canEdit).toBe(false);
      expect(part15Access.canRsvp).toBe(true);

      await expect(
        service.updateEvent(
          privateEvent.id,
          { title: 'Cố tình sửa trái phép' },
          { id: 15, username: 'user15', roles: ['staff'], permissions: ['calendar.update'] },
        ),
      ).rejects.toThrow(ForbiddenAppException);

      // Participant #15 phản hồi RSVP thành công
      const afterRsvp = await service.updateParticipantRsvp(
        privateEvent.id,
        { rsvpStatus: CALENDAR_RSVP_STATUS.ACCEPTED, responseNote: 'Tôi sẽ tham gia đúng giờ' },
        { id: 15, username: 'user15', roles: ['staff'], permissions: ['calendar.read'] },
      );
      expect(afterRsvp.participants.find((p) => p.userId === 15)?.rsvpStatus).toBe(
        CALENDAR_RSVP_STATUS.ACCEPTED,
      );

      // 3. Participant có quyền sửa (User #16, canEdit = true): Sửa được sự kiện
      const updatedByPart16 = await service.updateEvent(
        privateEvent.id,
        { location: 'Phòng họp VIP Tầng 15' },
        { id: 16, username: 'user16', roles: ['staff'], permissions: ['calendar.update'] },
      );
      expect(updatedByPart16.location).toBe('Phòng họp VIP Tầng 15');

      // 4. Manager (User #9 — Quản lý trực tiếp của Owner #10 & Trưởng đơn vị #3): Xem và sửa được sự kiện PRIVATE
      const managerAccess = await service.evaluateAccess(privateEvent.id, {
        id: 9,
        username: 'director_hcm',
        roles: ['branch_director'],
        permissions: ['calendar.read', 'calendar.update'],
      });
      expect(managerAccess.accessRole).toBe(CALENDAR_ACCESS_ROLE.MANAGER);
      expect(managerAccess.canView).toBe(true);
      expect(managerAccess.canEdit).toBe(true);

      const updatedByManager = await service.updateEvent(
        privateEvent.id,
        { title: 'Họp Đánh giá Nhân sự Mật (Manager duyệt)' },
        {
          id: 9,
          username: 'director_hcm',
          roles: ['branch_director'],
          permissions: ['calendar.update'],
        },
      );
      expect(updatedByManager.title).toBe('Họp Đánh giá Nhân sự Mật (Manager duyệt)');
    });
  });

  describe('9.7.7 & 9.7.8 — Tích hợp Google / Microsoft Calendar qua Adapter & Ghi lịch sử thay đổi sự kiện (Biết nguồn thay đổi)', () => {
    it('syncs events with Google & Microsoft Calendar adapters (outbound + inbound) and records full change history with accurate changeSource', async () => {
      const { service } = createInMemoryCalendarHarness();

      const ownerActor = {
        id: 10,
        username: 'emp10',
        roles: ['staff'],
        permissions: ['calendar.create', 'calendar.update', 'calendar.sync'],
      };

      // 1. Tạo sự kiện (nguồn WEB_UI)
      const created = await service.createEvent(
        {
          title: 'Họp Đối tác Chiến lược Q4',
          eventType: CALENDAR_EVENT_TYPE.MEETING,
          visibility: CALENDAR_VISIBILITY.PUBLIC,
          startAt: '2026-11-28T08:00:00.000Z',
          endAt: '2026-11-28T09:30:00.000Z',
          timezone: 'Asia/Ho_Chi_Minh',
          isAllDay: false,
          changeSource: CALENDAR_CHANGE_SOURCE.WEB_UI,
        },
        ownerActor,
      );

      // 2. Đồng bộ đẩy lên cả Google Calendar & Microsoft Calendar (nguồn API)
      const syncResult = await service.syncEventWithExternalProviders(
        created.id,
        {
          providers: [CALENDAR_EXTERNAL_PROVIDER.GOOGLE, CALENDAR_EXTERNAL_PROVIDER.MICROSOFT],
          changeSource: CALENDAR_CHANGE_SOURCE.API,
        },
        ownerActor,
      );

      expect(syncResult.syncedProviders).toEqual(['GOOGLE', 'MICROSOFT']);
      expect(syncResult.bindings.GOOGLE?.externalEventId).toContain('gcal_');
      expect(syncResult.bindings.GOOGLE?.conferenceUrl).toContain('https://meet.google.com/');
      expect(syncResult.bindings.MICROSOFT?.externalEventId).toContain('msgraph_');
      expect(syncResult.bindings.MICROSOFT?.conferenceUrl).toContain(
        'https://teams.microsoft.com/',
      );

      // 3. Đồng bộ chiều về từ Google Calendar (nguồn GOOGLE_SYNC)
      const afterGoogleInbound = await service.handleInboundExternalSync(
        CALENDAR_EXTERNAL_PROVIDER.GOOGLE,
        {
          eventId: created.id,
          externalEventId: syncResult.bindings.GOOGLE!.externalEventId,
          title: 'Họp Đối tác Chiến lược Q4 (Cập nhật từ Google Calendar)',
          location: 'Google Meet Online Room',
          reason: 'Người tạo đổi tiêu đề trên Google Calendar',
        },
        ownerActor,
      );
      expect(afterGoogleInbound.title).toBe(
        'Họp Đối tác Chiến lược Q4 (Cập nhật từ Google Calendar)',
      );

      // 4. Đồng bộ chiều về từ Microsoft Calendar (nguồn MICROSOFT_SYNC)
      await service.handleInboundExternalSync(
        CALENDAR_EXTERNAL_PROVIDER.MICROSOFT,
        {
          eventId: created.id,
          externalEventId: syncResult.bindings.MICROSOFT!.externalEventId,
          location: 'Microsoft Teams Room VIP',
          reason: 'Cập nhật phòng họp từ Outlook Calendar',
        },
        ownerActor,
      );

      // 5. Kiểm tra lịch sử thay đổi sự kiện biết rõ nguồn thay đổi (WEB_UI, API, GOOGLE_SYNC, MICROSOFT_SYNC)
      const allHistories = await service.listEventHistories(created.id, {}, ownerActor);
      expect(allHistories.map((h) => h.changeSource)).toEqual([
        CALENDAR_CHANGE_SOURCE.WEB_UI,
        CALENDAR_CHANGE_SOURCE.API,
        CALENDAR_CHANGE_SOURCE.GOOGLE_SYNC,
        CALENDAR_CHANGE_SOURCE.MICROSOFT_SYNC,
      ]);

      const googleHistories = await service.listEventHistories(
        created.id,
        { changeSource: CALENDAR_CHANGE_SOURCE.GOOGLE_SYNC },
        ownerActor,
      );
      expect(googleHistories).toHaveLength(1);
      expect(googleHistories[0]?.changedFields).toEqual(
        expect.arrayContaining(['title', 'location']),
      );
      expect(googleHistories[0]?.beforeSnapshot?.title).toBe('Họp Đối tác Chiến lược Q4');
      expect(googleHistories[0]?.afterSnapshot?.title).toBe(
        'Họp Đối tác Chiến lược Q4 (Cập nhật từ Google Calendar)',
      );
    });
  });
});
