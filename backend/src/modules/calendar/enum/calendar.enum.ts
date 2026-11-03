export { CALENDAR_ROUTES } from '../routes/calendar.routes.js';

export const CALENDAR_EVENT_STATUS = {
  SCHEDULED: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
  CANCELLED: 4,
  POSTPONED: 5,
} as const;

export type CalendarEventStatusCode =
  (typeof CALENDAR_EVENT_STATUS)[keyof typeof CALENDAR_EVENT_STATUS];

export type CalendarEventStatusName =
  'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED';

export const CALENDAR_EVENT_TYPE = {
  MEETING: 'MEETING',
  TRAINING: 'TRAINING',
  DEADLINE: 'DEADLINE',
  MAINTENANCE: 'MAINTENANCE',
  HOLIDAY: 'HOLIDAY',
  OTHER: 'OTHER',
} as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPE)[keyof typeof CALENDAR_EVENT_TYPE];

export const CALENDAR_VISIBILITY = {
  PUBLIC: 'PUBLIC',
  INTERNAL: 'INTERNAL',
  PRIVATE: 'PRIVATE',
} as const;

export type CalendarVisibility = (typeof CALENDAR_VISIBILITY)[keyof typeof CALENDAR_VISIBILITY];

export const CALENDAR_PARTICIPANT_TYPE = {
  USER: 'USER',
  ORGANIZATION_UNIT: 'ORGANIZATION_UNIT',
} as const;

export type CalendarParticipantType =
  (typeof CALENDAR_PARTICIPANT_TYPE)[keyof typeof CALENDAR_PARTICIPANT_TYPE];

export const CALENDAR_PARTICIPANT_ROLE = {
  ORGANIZER: 'ORGANIZER',
  REQUIRED: 'REQUIRED',
  OPTIONAL: 'OPTIONAL',
  ATTENDEE: 'ATTENDEE',
} as const;

export type CalendarParticipantRole =
  (typeof CALENDAR_PARTICIPANT_ROLE)[keyof typeof CALENDAR_PARTICIPANT_ROLE];

export const CALENDAR_RSVP_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  TENTATIVE: 'TENTATIVE',
} as const;

export type CalendarRsvpStatus = (typeof CALENDAR_RSVP_STATUS)[keyof typeof CALENDAR_RSVP_STATUS];

export const CALENDAR_RECURRENCE_FREQUENCY = {
  NONE: 'NONE',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;

export type CalendarRecurrenceFrequency =
  (typeof CALENDAR_RECURRENCE_FREQUENCY)[keyof typeof CALENDAR_RECURRENCE_FREQUENCY];

export const CALENDAR_REMINDER_STATUS = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
} as const;

export type CalendarReminderStatus =
  (typeof CALENDAR_REMINDER_STATUS)[keyof typeof CALENDAR_REMINDER_STATUS];

export const CALENDAR_EXTERNAL_PROVIDER = {
  GOOGLE: 'GOOGLE',
  MICROSOFT: 'MICROSOFT',
} as const;

export type CalendarExternalProvider =
  (typeof CALENDAR_EXTERNAL_PROVIDER)[keyof typeof CALENDAR_EXTERNAL_PROVIDER];

export const CALENDAR_CHANGE_SOURCE = {
  WEB_UI: 'WEB_UI',
  API: 'API',
  SCHEDULER: 'SCHEDULER',
  GOOGLE_SYNC: 'GOOGLE_SYNC',
  MICROSOFT_SYNC: 'MICROSOFT_SYNC',
  SYSTEM: 'SYSTEM',
} as const;

export type CalendarChangeSource =
  (typeof CALENDAR_CHANGE_SOURCE)[keyof typeof CALENDAR_CHANGE_SOURCE];

export const CALENDAR_HISTORY_ACTION_TYPE = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  RESCHEDULED: 'RESCHEDULED',
  PARTICIPANTS_CHANGED: 'PARTICIPANTS_CHANGED',
  RSVP_UPDATED: 'RSVP_UPDATED',
  RECURRENCE_UPDATED: 'RECURRENCE_UPDATED',
  REMINDER_SENT: 'REMINDER_SENT',
  EXTERNAL_SYNCED: 'EXTERNAL_SYNCED',
  CANCELLED: 'CANCELLED',
  STATUS_CHANGED: 'STATUS_CHANGED',
} as const;

export type CalendarHistoryActionType =
  (typeof CALENDAR_HISTORY_ACTION_TYPE)[keyof typeof CALENDAR_HISTORY_ACTION_TYPE];

export const CALENDAR_ACCESS_ROLE = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  PARTICIPANT: 'PARTICIPANT',
  VIEWER: 'VIEWER',
  NONE: 'NONE',
} as const;

export type CalendarAccessRole = (typeof CALENDAR_ACCESS_ROLE)[keyof typeof CALENDAR_ACCESS_ROLE];

export const CALENDAR_CONFLICT_TYPE = {
  RESOURCE: 'RESOURCE',
  PARTICIPANT_USER: 'PARTICIPANT_USER',
  PARTICIPANT_ORG_UNIT: 'PARTICIPANT_ORG_UNIT',
} as const;

export type CalendarConflictType =
  (typeof CALENDAR_CONFLICT_TYPE)[keyof typeof CALENDAR_CONFLICT_TYPE];

export const CALENDAR_CODE_TYPES = {
  EVENT_STATUS: 'calendar.event_status',
  EVENT_TYPE: 'calendar.event_type',
} as const;

export const CALENDAR_SETTING_KEYS = {
  PAGINATION_PREFIX: 'calendar.pagination',
  DEFAULT_REMINDER_MINUTES: 'calendar.reminder.default_minutes_before',
  MAX_RECURRENCE_OCCURRENCES: 'calendar.recurrence.max_occurrences',
  BLOCK_ON_RESOURCE_CONFLICT: 'calendar.conflict.block_on_resource_conflict',
  BLOCK_ON_PARTICIPANT_CONFLICT: 'calendar.conflict.block_on_participant_conflict',
  AUTO_SYNC_ON_CHANGE: 'calendar.sync.auto_sync_on_change',
  GOOGLE_CALENDAR_ID: 'calendar.google.calendar_id',
  MICROSOFT_CALENDAR_ID: 'calendar.microsoft.calendar_id',
} as const;

export const CALENDAR_FEATURE_FLAGS = {
  REMINDERS_ENABLED: 'calendar.reminders_enabled',
  GOOGLE_SYNC_ENABLED: 'calendar.google_sync_enabled',
  MICROSOFT_SYNC_ENABLED: 'calendar.microsoft_sync_enabled',
} as const;

export const CALENDAR_SEQUENCE_KEYS = {
  EVENT_CODE: 'calendar.event_code',
} as const;

export const CALENDAR_AUDIT_META = {
  MODULE: 'calendar',
  FEATURES: {
    EVENT: 'calendar_event',
    PARTICIPANT: 'calendar_participant',
    REMINDER: 'calendar_reminder',
    INTEGRATION: 'calendar_integration',
  },
  RESOURCE_TYPES: {
    EVENT: 'calendar_event',
  },
} as const;
