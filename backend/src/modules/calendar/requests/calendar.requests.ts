import { z } from 'zod';
import { optionalQueryParam } from '@packages/http/index.js';
import {
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_EVENT_TYPE,
  CALENDAR_EXTERNAL_PROVIDER,
  CALENDAR_HISTORY_ACTION_TYPE,
  CALENDAR_PARTICIPANT_ROLE,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_RECURRENCE_FREQUENCY,
  CALENDAR_RSVP_STATUS,
  CALENDAR_VISIBILITY,
  parseCalendarEventStatus,
} from '../contracts/index.js';

export const positiveIntParamSchema = z.coerce.number().int().positive();

export const providerParamSchema = z
  .string()
  .trim()
  .transform((val) => val.toUpperCase())
  .pipe(z.enum([CALENDAR_EXTERNAL_PROVIDER.GOOGLE, CALENDAR_EXTERNAL_PROVIDER.MICROSOFT]));

export const calendarRecurrenceRuleSchema = z.object({
  frequency: z
    .enum([
      CALENDAR_RECURRENCE_FREQUENCY.NONE,
      CALENDAR_RECURRENCE_FREQUENCY.DAILY,
      CALENDAR_RECURRENCE_FREQUENCY.WEEKLY,
      CALENDAR_RECURRENCE_FREQUENCY.MONTHLY,
    ])
    .default(CALENDAR_RECURRENCE_FREQUENCY.NONE),
  interval: z.coerce.number().int().min(1).max(365).default(1),
  byWeekDays: z.array(z.coerce.number().int().min(0).max(6)).optional(),
  byMonthDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  count: z.coerce.number().int().min(1).max(730).nullable().optional(),
  until: z.string().trim().min(4).max(64).nullable().optional(),
  exceptionDates: z.array(z.string().trim().min(4).max(32)).optional(),
});

export const calendarReminderRuleSchema = z.object({
  minutesBefore: z.coerce.number().int().min(0).max(10080).default(15),
  channels: z.array(z.string().trim().min(1).max(32)).default(['IN_APP']),
});

export const calendarParticipantInputSchema = z.object({
  participantType: z
    .enum([CALENDAR_PARTICIPANT_TYPE.USER, CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT])
    .default(CALENDAR_PARTICIPANT_TYPE.USER),
  userId: z.coerce.number().int().positive().nullable().optional(),
  organizationUnitId: z.coerce.number().int().positive().nullable().optional(),
  role: z
    .enum([
      CALENDAR_PARTICIPANT_ROLE.ORGANIZER,
      CALENDAR_PARTICIPANT_ROLE.REQUIRED,
      CALENDAR_PARTICIPANT_ROLE.OPTIONAL,
      CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
    ])
    .default(CALENDAR_PARTICIPANT_ROLE.ATTENDEE),
  canEdit: z.boolean().optional(),
  rsvpStatus: z
    .enum([
      CALENDAR_RSVP_STATUS.PENDING,
      CALENDAR_RSVP_STATUS.ACCEPTED,
      CALENDAR_RSVP_STATUS.DECLINED,
      CALENDAR_RSVP_STATUS.TENTATIVE,
    ])
    .optional(),
  responseNote: z.string().trim().max(500).nullable().optional(),
});

const changeSourceSchema = z
  .enum([
    CALENDAR_CHANGE_SOURCE.WEB_UI,
    CALENDAR_CHANGE_SOURCE.API,
    CALENDAR_CHANGE_SOURCE.SCHEDULER,
    CALENDAR_CHANGE_SOURCE.GOOGLE_SYNC,
    CALENDAR_CHANGE_SOURCE.MICROSOFT_SYNC,
    CALENDAR_CHANGE_SOURCE.SYSTEM,
  ])
  .optional();

export const createCalendarEventSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  eventType: z.string().trim().min(1).max(64).default(CALENDAR_EVENT_TYPE.MEETING),
  visibility: z
    .enum([CALENDAR_VISIBILITY.PUBLIC, CALENDAR_VISIBILITY.INTERNAL, CALENDAR_VISIBILITY.PRIVATE])
    .default(CALENDAR_VISIBILITY.PUBLIC),
  startAt: z.string().trim().min(4),
  endAt: z.string().trim().min(4),
  timezone: z.string().trim().min(2).max(64).default('Asia/Ho_Chi_Minh'),
  isAllDay: z.boolean().default(false),
  location: z.string().trim().max(255).nullable().optional(),
  meetingUrl: z.string().trim().max(500).nullable().optional(),
  resourceCode: z.string().trim().max(64).nullable().optional(),
  resourceName: z.string().trim().max(180).nullable().optional(),
  ownerUserId: z.coerce.number().int().positive().optional(),
  organizationUnitId: z.coerce.number().int().positive().nullable().optional(),
  recurrenceRule: calendarRecurrenceRuleSchema.nullable().optional(),
  reminderRules: z.array(calendarReminderRuleSchema).optional(),
  participants: z.array(calendarParticipantInputSchema).optional(),
  syncProviders: z
    .array(z.enum([CALENDAR_EXTERNAL_PROVIDER.GOOGLE, CALENDAR_EXTERNAL_PROVIDER.MICROSOFT]))
    .optional(),
  allowConflictOverride: z.boolean().optional(),
  strictConflictCheck: z.boolean().optional(),
  changeSource: changeSourceSchema,
  reason: z.string().trim().max(500).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type CreateCalendarEventRequest = z.infer<typeof createCalendarEventSchema>;

export const updateCalendarEventSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  eventType: z.string().trim().min(1).max(64).optional(),
  status: z.preprocess(
    (v) => (v === undefined ? undefined : parseCalendarEventStatus(v)),
    z.number().int().optional(),
  ),
  visibility: z
    .enum([CALENDAR_VISIBILITY.PUBLIC, CALENDAR_VISIBILITY.INTERNAL, CALENDAR_VISIBILITY.PRIVATE])
    .optional(),
  startAt: z.string().trim().min(4).optional(),
  endAt: z.string().trim().min(4).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  isAllDay: z.boolean().optional(),
  location: z.string().trim().max(255).nullable().optional(),
  meetingUrl: z.string().trim().max(500).nullable().optional(),
  resourceCode: z.string().trim().max(64).nullable().optional(),
  resourceName: z.string().trim().max(180).nullable().optional(),
  organizationUnitId: z.coerce.number().int().positive().nullable().optional(),
  recurrenceRule: calendarRecurrenceRuleSchema.nullable().optional(),
  reminderRules: z.array(calendarReminderRuleSchema).optional(),
  participants: z.array(calendarParticipantInputSchema).optional(),
  syncProviders: z
    .array(z.enum([CALENDAR_EXTERNAL_PROVIDER.GOOGLE, CALENDAR_EXTERNAL_PROVIDER.MICROSOFT]))
    .optional(),
  allowConflictOverride: z.boolean().optional(),
  strictConflictCheck: z.boolean().optional(),
  changeSource: changeSourceSchema,
  reason: z.string().trim().max(500).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type UpdateCalendarEventRequest = z.infer<typeof updateCalendarEventSchema>;

export const addCalendarParticipantsSchema = z.object({
  participants: z.array(calendarParticipantInputSchema).min(1),
  replaceExisting: z.boolean().optional(),
  allowConflictOverride: z.boolean().optional(),
  strictConflictCheck: z.boolean().optional(),
  changeSource: changeSourceSchema,
  reason: z.string().trim().max(500).nullable().optional(),
});

export type AddCalendarParticipantsRequest = z.infer<typeof addCalendarParticipantsSchema>;

export const updateCalendarRsvpSchema = z.object({
  rsvpStatus: z.enum([
    CALENDAR_RSVP_STATUS.ACCEPTED,
    CALENDAR_RSVP_STATUS.DECLINED,
    CALENDAR_RSVP_STATUS.TENTATIVE,
  ]),
  responseNote: z.string().trim().max(500).nullable().optional(),
  changeSource: changeSourceSchema,
});

export type UpdateCalendarRsvpRequest = z.infer<typeof updateCalendarRsvpSchema>;

export const cancelCalendarEventSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  changeSource: changeSourceSchema,
});

export type CancelCalendarEventRequest = z.infer<typeof cancelCalendarEventSchema>;

export const checkCalendarConflictsSchema = z.object({
  startAt: z.string().trim().min(4),
  endAt: z.string().trim().min(4),
  recurrenceRule: calendarRecurrenceRuleSchema.nullable().optional(),
  ownerUserId: z.coerce.number().int().positive().nullable().optional(),
  resourceCode: z.string().trim().max(64).nullable().optional(),
  participantUserIds: z.array(z.coerce.number().int().positive()).optional(),
  participantOrganizationUnitIds: z.array(z.coerce.number().int().positive()).optional(),
  excludeEventId: z.coerce.number().int().positive().nullable().optional(),
});

export type CheckCalendarConflictsRequest = z.infer<typeof checkCalendarConflictsSchema>;

export const syncCalendarExternalSchema = z.object({
  providers: z
    .array(z.enum([CALENDAR_EXTERNAL_PROVIDER.GOOGLE, CALENDAR_EXTERNAL_PROVIDER.MICROSOFT]))
    .min(1),
  calendarIdOverride: z.string().trim().max(128).nullable().optional(),
  changeSource: changeSourceSchema,
});

export type SyncCalendarExternalRequest = z.infer<typeof syncCalendarExternalSchema>;

export const inboundExternalCalendarSyncSchema = z.object({
  eventId: z.coerce.number().int().positive().optional(),
  eventCode: z.string().trim().max(64).optional(),
  externalEventId: z.string().trim().min(1).max(180),
  calendarId: z.string().trim().max(128).optional(),
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  startAt: z.string().trim().min(4).optional(),
  endAt: z.string().trim().min(4).optional(),
  location: z.string().trim().max(255).nullable().optional(),
  status: z.enum(['CONFIRMED', 'TENTATIVE', 'CANCELLED']).optional(),
  etag: z.string().trim().max(180).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type InboundExternalCalendarSyncRequest = z.infer<typeof inboundExternalCalendarSyncSchema>;

export const scanCalendarRemindersSchema = z.object({
  now: z.string().trim().optional(),
});

export type ScanCalendarRemindersRequest = z.infer<typeof scanCalendarRemindersSchema>;

export const listCalendarEventsQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)).default(1),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)).default(20),
  countMode: optionalQueryParam(z.enum(['exact', 'estimated', 'none'])),
  search: optionalQueryParam(z.string().trim().max(150)),
  eventType: optionalQueryParam(z.string().trim().max(64)),
  status: optionalQueryParam(z.preprocess((v) => parseCalendarEventStatus(v), z.number().int())),
  visibility: optionalQueryParam(
    z.enum([CALENDAR_VISIBILITY.PUBLIC, CALENDAR_VISIBILITY.INTERNAL, CALENDAR_VISIBILITY.PRIVATE]),
  ),
  ownerUserId: optionalQueryParam(z.coerce.number().int().positive()),
  organizationUnitId: optionalQueryParam(z.coerce.number().int().positive()),
  participantUserId: optionalQueryParam(z.coerce.number().int().positive()),
  participantOrgUnitId: optionalQueryParam(z.coerce.number().int().positive()),
  resourceCode: optionalQueryParam(z.string().trim().max(64)),
  fromDate: optionalQueryParam(z.string().trim().max(64)),
  toDate: optionalQueryParam(z.string().trim().max(64)),
});

export type ListCalendarEventsQuery = z.infer<typeof listCalendarEventsQuerySchema>;

export const listCalendarOccurrencesQuerySchema = z.object({
  fromDate: optionalQueryParam(z.string().trim().max(64)),
  toDate: optionalQueryParam(z.string().trim().max(64)),
  participantUserId: optionalQueryParam(z.coerce.number().int().positive()),
  participantOrgUnitId: optionalQueryParam(z.coerce.number().int().positive()),
  resourceCode: optionalQueryParam(z.string().trim().max(64)),
  maxOccurrences: optionalQueryParam(z.coerce.number().int().min(1).max(365)),
});

export type ListCalendarOccurrencesQuery = z.infer<typeof listCalendarOccurrencesQuerySchema>;

export const listCalendarHistoriesQuerySchema = z.object({
  changeSource: optionalQueryParam(
    z.enum([
      CALENDAR_CHANGE_SOURCE.WEB_UI,
      CALENDAR_CHANGE_SOURCE.API,
      CALENDAR_CHANGE_SOURCE.SCHEDULER,
      CALENDAR_CHANGE_SOURCE.GOOGLE_SYNC,
      CALENDAR_CHANGE_SOURCE.MICROSOFT_SYNC,
      CALENDAR_CHANGE_SOURCE.SYSTEM,
    ]),
  ),
  actionType: optionalQueryParam(
    z.enum([
      CALENDAR_HISTORY_ACTION_TYPE.CREATED,
      CALENDAR_HISTORY_ACTION_TYPE.UPDATED,
      CALENDAR_HISTORY_ACTION_TYPE.RESCHEDULED,
      CALENDAR_HISTORY_ACTION_TYPE.PARTICIPANTS_CHANGED,
      CALENDAR_HISTORY_ACTION_TYPE.RSVP_UPDATED,
      CALENDAR_HISTORY_ACTION_TYPE.RECURRENCE_UPDATED,
      CALENDAR_HISTORY_ACTION_TYPE.REMINDER_SENT,
      CALENDAR_HISTORY_ACTION_TYPE.EXTERNAL_SYNCED,
      CALENDAR_HISTORY_ACTION_TYPE.CANCELLED,
      CALENDAR_HISTORY_ACTION_TYPE.STATUS_CHANGED,
    ]),
  ),
});

export type ListCalendarHistoriesQuery = z.infer<typeof listCalendarHistoriesQuerySchema>;
