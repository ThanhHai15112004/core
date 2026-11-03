import { defaultFeatureFlagRegistry, safeJsonParseStringArray } from '@packages/kernel/index.js';
import {
  type INotificationsPublicService,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
} from '@modules/notifications/contracts/index.js';
import type { IOrganizationsPublicService } from '@modules/organizations/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import {
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_EVENT_STATUS,
  CALENDAR_FEATURE_FLAGS,
  CALENDAR_HISTORY_ACTION_TYPE,
  CALENDAR_REMINDER_STATUS,
  CALENDAR_RSVP_STATUS,
} from '../enum/calendar.enum.js';
import type { CalendarEventHistoryRepository } from '../repositories/calendar-event-history.repository.js';
import type { CalendarEventParticipantRepository } from '../repositories/calendar-event-participant.repository.js';
import type { CalendarEventReminderRepository } from '../repositories/calendar-event-reminder.repository.js';
import type { CalendarEventRepository } from '../repositories/calendar-event.repository.js';
import type { CalendarReminderScanResultView } from '../types/calendar.types.js';
import { resolveEventTargetUserIds } from './calendar-permission.helper.js';

/**
 * 9.7.4: Quét và gửi nhắc lịch tự động qua Notification và Scheduler.
 */
export async function executeCalendarReminderScan(params: {
  now?: Date | undefined;
  eventRepository: CalendarEventRepository;
  participantRepository: CalendarEventParticipantRepository;
  reminderRepository: CalendarEventReminderRepository;
  historyRepository: CalendarEventHistoryRepository;
  notificationsPublicService?: INotificationsPublicService | null | undefined;
  usersPublicService?: IUsersPublicService | null | undefined;
  organizationsPublicService?: IOrganizationsPublicService | null | undefined;
}): Promise<CalendarReminderScanResultView> {
  const {
    now = new Date(),
    eventRepository,
    participantRepository,
    reminderRepository,
    historyRepository,
    notificationsPublicService,
    usersPublicService,
    organizationsPublicService,
  } = params;

  if (!defaultFeatureFlagRegistry.isEnabled(CALENDAR_FEATURE_FLAGS.REMINDERS_ENABLED)) {
    return {
      scannedAt: now.toISOString(),
      dueReminderCount: 0,
      dispatchedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      dispatchedReminderIds: [],
    };
  }

  const dueReminders = await reminderRepository.findDuePendingReminders(now);
  if (dueReminders.length === 0) {
    return {
      scannedAt: now.toISOString(),
      dueReminderCount: 0,
      dispatchedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      dispatchedReminderIds: [],
    };
  }

  const eventIds = [...new Set(dueReminders.map((r) => Number(r.calendarEventId)))];
  const [events, allParticipants] = await Promise.all([
    eventRepository.findByIds(eventIds),
    participantRepository.findByEventIds(eventIds),
  ]);

  const eventMap = new Map(events.map((e) => [Number(e.id), e]));
  const partsByEvent = new Map<number, typeof allParticipants>();
  for (const p of allParticipants) {
    const eid = Number(p.calendarEventId);
    const list = partsByEvent.get(eid) ?? [];
    list.push(p);
    partsByEvent.set(eid, list);
  }

  let dispatchedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const dispatchedReminderIds: number[] = [];

  for (const reminder of dueReminders) {
    const event = eventMap.get(Number(reminder.calendarEventId));
    if (
      !event ||
      event.status === CALENDAR_EVENT_STATUS.CANCELLED ||
      event.status === CALENDAR_EVENT_STATUS.COMPLETED
    ) {
      reminder.status = CALENDAR_REMINDER_STATUS.SKIPPED;
      reminder.errorMessage = 'Event cancelled or completed';
      await reminderRepository.saveEntity(reminder);
      skippedCount++;
      continue;
    }

    const activeParticipants = (partsByEvent.get(Number(event.id)) ?? []).filter(
      (p) => p.rsvpStatus !== CALENDAR_RSVP_STATUS.DECLINED,
    );

    const targetUserIds = await resolveEventTargetUserIds({
      event,
      participants: activeParticipants,
      usersPublicService,
      organizationsPublicService,
    });

    if (targetUserIds.length === 0) {
      reminder.status = CALENDAR_REMINDER_STATUS.SKIPPED;
      reminder.errorMessage = 'No active recipients resolved';
      await reminderRepository.saveEntity(reminder);
      skippedCount++;
      continue;
    }

    try {
      let notificationId: number | null = null;
      let recipientCount = targetUserIds.length;
      const channels = safeJsonParseStringArray(reminder.channelsJson);

      if (notificationsPublicService) {
        const occIso = new Date(reminder.occurrenceStartAt).toISOString();
        const dispatchRes = await notificationsPublicService.dispatch({
          title: `[NHẮC LỊCH] ${event.title} (${event.code})`,
          content: `Sự kiện "${event.title}" sẽ diễn ra vào lúc ${occIso}${event.location ? ` tại ${event.location}` : ''} (nhắc trước ${reminder.minutesBefore} phút).`,
          category: NOTIFICATION_CATEGORY.WORK,
          priority: NOTIFICATION_PRIORITY.HIGH,
          targetType:
            targetUserIds.length === 1
              ? NOTIFICATION_TARGET_TYPE.SINGLE_USER
              : NOTIFICATION_TARGET_TYPE.USER_GROUP,
          ...(targetUserIds.length === 1
            ? { userId: targetUserIds[0] }
            : { userIds: targetUserIds }),
          referenceModule: 'calendar',
          referenceType: 'calendar_event',
          referenceId: String(event.id),
          actionUrl: '/calendar',
          organizationUnitId: event.organizationUnitId ?? null,
        });
        notificationId = dispatchRes.id ?? null;
        recipientCount =
          dispatchRes.totalTargeted ??
          (Array.isArray(dispatchRes.recipients)
            ? dispatchRes.recipients.length
            : targetUserIds.length);
      }

      reminder.status = CALENDAR_REMINDER_STATUS.SENT;
      reminder.notificationId = notificationId;
      reminder.recipientCount = recipientCount;
      reminder.sentAt = now;
      reminder.errorMessage = null;
      await reminderRepository.saveEntity(reminder);

      await historyRepository.recordHistory({
        calendarEventId: Number(event.id),
        actionType: CALENDAR_HISTORY_ACTION_TYPE.REMINDER_SENT,
        changeSource: CALENDAR_CHANGE_SOURCE.SCHEDULER,
        actorUserId: null,
        reason: `Đã gửi nhắc lịch tự động trước ${reminder.minutesBefore} phút cho ${recipientCount} người tham gia`,
        metadata: {
          reminderId: Number(reminder.id),
          occurrenceStartAt: new Date(reminder.occurrenceStartAt).toISOString(),
          minutesBefore: reminder.minutesBefore,
          channels: channels.length > 0 ? channels : ['IN_APP'],
          notificationId,
          recipientCount,
        },
      });

      dispatchedCount++;
      dispatchedReminderIds.push(Number(reminder.id));
    } catch (err) {
      reminder.status = CALENDAR_REMINDER_STATUS.FAILED;
      reminder.errorMessage =
        err instanceof Error ? err.message.slice(0, 480) : 'Reminder dispatch failed';
      await reminderRepository.saveEntity(reminder);
      failedCount++;
    }
  }

  return {
    scannedAt: now.toISOString(),
    dueReminderCount: dueReminders.length,
    dispatchedCount,
    skippedCount,
    failedCount,
    dispatchedReminderIds,
  };
}
