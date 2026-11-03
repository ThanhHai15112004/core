import { defaultCodeRegistry } from '@packages/kernel/index.js';
import {
  CALENDAR_ACCESS_ROLE,
  CALENDAR_AUDIT_META,
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_CODE_TYPES,
  CALENDAR_CONFLICT_TYPE,
  CALENDAR_EVENT_STATUS,
  CALENDAR_EVENT_TYPE,
  CALENDAR_EXTERNAL_PROVIDER,
  CALENDAR_FEATURE_FLAGS,
  CALENDAR_HISTORY_ACTION_TYPE,
  CALENDAR_PARTICIPANT_ROLE,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_RECURRENCE_FREQUENCY,
  CALENDAR_REMINDER_STATUS,
  CALENDAR_ROUTES,
  CALENDAR_RSVP_STATUS,
  CALENDAR_SEQUENCE_KEYS,
  CALENDAR_SETTING_KEYS,
  CALENDAR_VISIBILITY,
  type CalendarAccessRole,
  type CalendarChangeSource,
  type CalendarConflictType,
  type CalendarEventStatusCode,
  type CalendarEventStatusName,
  type CalendarEventType,
  type CalendarExternalProvider,
  type CalendarHistoryActionType,
  type CalendarParticipantRole,
  type CalendarParticipantType,
  type CalendarRecurrenceFrequency,
  type CalendarReminderStatus,
  type CalendarRsvpStatus,
  type CalendarVisibility,
} from '../enum/calendar.enum.js';
import type {
  CalendarConflictCheckResultView,
  CalendarConflictItemView,
  CalendarEventAccessEvaluation,
  CalendarEventDetailView,
  CalendarEventHistoryItemView,
  CalendarEventItemView,
  CalendarEventOccurrenceView,
  CalendarEventParticipantItemView,
  CalendarEventReminderItemView,
  CalendarExternalBindingRecord,
  CalendarExternalBindingsMap,
  CalendarExternalSyncResultView,
  CalendarProviderStatusView,
  CalendarRecurrenceRule,
  CalendarReminderRule,
  CalendarReminderScanResultView,
} from '../types/calendar.types.js';

export {
  CALENDAR_ACCESS_ROLE,
  CALENDAR_AUDIT_META,
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_CODE_TYPES,
  CALENDAR_CONFLICT_TYPE,
  CALENDAR_EVENT_STATUS,
  CALENDAR_EVENT_TYPE,
  CALENDAR_EXTERNAL_PROVIDER,
  CALENDAR_FEATURE_FLAGS,
  CALENDAR_HISTORY_ACTION_TYPE,
  CALENDAR_PARTICIPANT_ROLE,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_RECURRENCE_FREQUENCY,
  CALENDAR_REMINDER_STATUS,
  CALENDAR_ROUTES,
  CALENDAR_RSVP_STATUS,
  CALENDAR_SEQUENCE_KEYS,
  CALENDAR_SETTING_KEYS,
  CALENDAR_VISIBILITY,
  type CalendarAccessRole,
  type CalendarChangeSource,
  type CalendarConflictType,
  type CalendarEventStatusCode,
  type CalendarEventStatusName,
  type CalendarEventType,
  type CalendarExternalProvider,
  type CalendarHistoryActionType,
  type CalendarParticipantRole,
  type CalendarParticipantType,
  type CalendarRecurrenceFrequency,
  type CalendarReminderStatus,
  type CalendarRsvpStatus,
  type CalendarVisibility,
  type CalendarConflictCheckResultView,
  type CalendarConflictItemView,
  type CalendarEventAccessEvaluation,
  type CalendarEventDetailView,
  type CalendarEventHistoryItemView,
  type CalendarEventItemView,
  type CalendarEventOccurrenceView,
  type CalendarEventParticipantItemView,
  type CalendarEventReminderItemView,
  type CalendarExternalBindingRecord,
  type CalendarExternalBindingsMap,
  type CalendarExternalSyncResultView,
  type CalendarProviderStatusView,
  type CalendarRecurrenceRule,
  type CalendarReminderRule,
  type CalendarReminderScanResultView,
};

export function parseCalendarEventStatus(val: unknown): CalendarEventStatusCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    CALENDAR_CODE_TYPES.EVENT_STATUS,
    val,
    CALENDAR_EVENT_STATUS.SCHEDULED,
  );
  if (
    resolved === CALENDAR_EVENT_STATUS.SCHEDULED ||
    resolved === CALENDAR_EVENT_STATUS.IN_PROGRESS ||
    resolved === CALENDAR_EVENT_STATUS.COMPLETED ||
    resolved === CALENDAR_EVENT_STATUS.CANCELLED ||
    resolved === CALENDAR_EVENT_STATUS.POSTPONED
  ) {
    return resolved;
  }
  return CALENDAR_EVENT_STATUS.SCHEDULED;
}

export function getCalendarEventStatusName(code: number): CalendarEventStatusName {
  switch (code) {
    case CALENDAR_EVENT_STATUS.IN_PROGRESS:
      return 'IN_PROGRESS';
    case CALENDAR_EVENT_STATUS.COMPLETED:
      return 'COMPLETED';
    case CALENDAR_EVENT_STATUS.CANCELLED:
      return 'CANCELLED';
    case CALENDAR_EVENT_STATUS.POSTPONED:
      return 'POSTPONED';
    default:
      return 'SCHEDULED';
  }
}

export interface ICalendarPublicService {
  getEventById(id: number): Promise<CalendarEventDetailView>;
  scanAndDispatchReminders(now?: Date): Promise<CalendarReminderScanResultView>;
}

export const CALENDAR_PUBLIC_SERVICE = Symbol('CALENDAR_PUBLIC_SERVICE');
