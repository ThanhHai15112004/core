import { z } from 'zod';

export const calendarRecurrenceRuleResponseSchema = z.object({
  frequency: z.string(),
  interval: z.number().int(),
  byWeekDays: z.array(z.number().int()).optional(),
  byMonthDay: z.number().int().nullable().optional(),
  count: z.number().int().nullable().optional(),
  until: z.string().nullable().optional(),
  exceptionDates: z.array(z.string()).optional(),
});

export const calendarReminderRuleResponseSchema = z.object({
  minutesBefore: z.number().int(),
  channels: z.array(z.string()),
});

export const calendarParticipantItemResponseSchema = z.object({
  id: z.number().int(),
  calendarEventId: z.number().int(),
  participantType: z.string(),
  userId: z.number().int().nullable(),
  userFullName: z.string().nullable(),
  username: z.string().nullable(),
  organizationUnitId: z.number().int().nullable(),
  organizationUnitCode: z.string().nullable(),
  organizationUnitName: z.string().nullable(),
  role: z.string(),
  canEdit: z.boolean(),
  rsvpStatus: z.string(),
  responseNote: z.string().nullable(),
  respondedAt: z.string().nullable(),
  addedByUserId: z.number().int().nullable(),
  createdAt: z.string(),
});

export const calendarReminderItemResponseSchema = z.object({
  id: z.number().int(),
  calendarEventId: z.number().int(),
  occurrenceStartAt: z.string(),
  minutesBefore: z.number().int(),
  remindAt: z.string(),
  channels: z.array(z.string()),
  status: z.string(),
  notificationId: z.number().int().nullable(),
  recipientCount: z.number().int(),
  sentAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});

export const calendarHistoryItemResponseSchema = z.object({
  id: z.number().int(),
  calendarEventId: z.number().int(),
  actionType: z.string(),
  changeSource: z.string(),
  actorUserId: z.number().int().nullable(),
  actorFullName: z.string().nullable(),
  changedFields: z.array(z.string()),
  beforeSnapshot: z.record(z.string(), z.unknown()).nullable(),
  afterSnapshot: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

export const calendarAccessEvaluationResponseSchema = z.object({
  accessRole: z.string(),
  canView: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canManageParticipants: z.boolean(),
  canRsvp: z.boolean(),
  matchedReasons: z.array(z.string()),
});

export const calendarOccurrenceItemResponseSchema = z.object({
  occurrenceIndex: z.number().int(),
  eventId: z.number().int(),
  eventCode: z.string(),
  title: z.string(),
  eventType: z.string(),
  status: z.number().int(),
  statusName: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  isAllDay: z.boolean(),
  isRecurringInstance: z.boolean(),
  location: z.string().nullable(),
  resourceCode: z.string().nullable(),
  resourceName: z.string().nullable(),
  ownerUserId: z.number().int(),
  organizationUnitId: z.number().int().nullable(),
});

export const calendarEventItemResponseSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  eventType: z.string(),
  status: z.number().int(),
  statusName: z.string(),
  visibility: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  durationMinutes: z.number().int(),
  timezone: z.string(),
  isAllDay: z.boolean(),
  location: z.string().nullable(),
  meetingUrl: z.string().nullable(),
  resourceCode: z.string().nullable(),
  resourceName: z.string().nullable(),
  ownerUserId: z.number().int(),
  ownerFullName: z.string().nullable(),
  organizationUnitId: z.number().int().nullable(),
  organizationUnitName: z.string().nullable(),
  isRecurring: z.boolean(),
  recurrenceRule: calendarRecurrenceRuleResponseSchema.nullable(),
  reminderRules: z.array(calendarReminderRuleResponseSchema),
  externalBindings: z.record(z.string(), z.unknown()),
  participantCount: z.number().int(),
  cancelReason: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const calendarEventDetailResponseSchema = calendarEventItemResponseSchema.extend({
  participants: z.array(calendarParticipantItemResponseSchema),
  upcomingOccurrences: z.array(calendarOccurrenceItemResponseSchema),
  reminders: z.array(calendarReminderItemResponseSchema),
  histories: z.array(calendarHistoryItemResponseSchema),
  viewerAccess: calendarAccessEvaluationResponseSchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const calendarConflictCheckResponseSchema = z.object({
  hasConflict: z.boolean(),
  resourceConflictCount: z.number().int(),
  participantConflictCount: z.number().int(),
  conflicts: z.array(
    z.object({
      conflictType: z.string(),
      conflictingEventId: z.number().int(),
      conflictingEventCode: z.string(),
      conflictingEventTitle: z.string(),
      overlapStartAt: z.string(),
      overlapEndAt: z.string(),
      resourceCode: z.string().nullable(),
      userId: z.number().int().nullable(),
      organizationUnitId: z.number().int().nullable(),
      message: z.string(),
    }),
  ),
});

export const calendarReminderScanResponseSchema = z.object({
  scannedAt: z.string(),
  dueReminderCount: z.number().int(),
  dispatchedCount: z.number().int(),
  skippedCount: z.number().int(),
  failedCount: z.number().int(),
  dispatchedReminderIds: z.array(z.number().int()),
});

export const calendarProviderStatusResponseSchema = z.object({
  provider: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  defaultCalendarId: z.string(),
  autoSyncOnChange: z.boolean(),
  capabilities: z.array(z.string()),
});

export const calendarExternalSyncResponseSchema = z.object({
  eventId: z.number().int(),
  eventCode: z.string(),
  syncedProviders: z.array(z.string()),
  bindings: z.record(z.string(), z.unknown()),
});
