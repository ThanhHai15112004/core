import type {
  CalendarAccessRole,
  CalendarChangeSource,
  CalendarConflictType,
  CalendarEventStatusCode,
  CalendarEventStatusName,
  CalendarEventType,
  CalendarExternalProvider,
  CalendarHistoryActionType,
  CalendarParticipantRole,
  CalendarParticipantType,
  CalendarRecurrenceFrequency,
  CalendarReminderStatus,
  CalendarRsvpStatus,
  CalendarVisibility,
} from '../enum/calendar.enum.js';

export interface CalendarRecurrenceRule {
  readonly frequency: CalendarRecurrenceFrequency;
  readonly interval: number;
  readonly byWeekDays?: readonly number[] | undefined;
  readonly byMonthDay?: number | null | undefined;
  readonly count?: number | null | undefined;
  readonly until?: string | null | undefined;
  readonly exceptionDates?: readonly string[] | undefined;
}

export interface CalendarReminderRule {
  readonly minutesBefore: number;
  readonly channels: readonly string[];
}

export interface CalendarExternalBindingRecord {
  readonly provider: CalendarExternalProvider;
  readonly calendarId: string;
  readonly externalEventId: string;
  readonly etag: string | null;
  readonly externalUrl: string | null;
  readonly conferenceUrl: string | null;
  readonly lastSyncedAt: string;
  readonly syncStatus: 'SYNCED' | 'CANCELLED' | 'FAILED';
  readonly lastError?: string | null | undefined;
}

export type CalendarExternalBindingsMap = Partial<
  Record<CalendarExternalProvider, CalendarExternalBindingRecord>
>;

export interface CalendarEventParticipantItemView {
  readonly id: number;
  readonly calendarEventId: number;
  readonly participantType: CalendarParticipantType;
  readonly userId: number | null;
  readonly userFullName: string | null;
  readonly username: string | null;
  readonly organizationUnitId: number | null;
  readonly organizationUnitCode: string | null;
  readonly organizationUnitName: string | null;
  readonly role: CalendarParticipantRole;
  readonly canEdit: boolean;
  readonly rsvpStatus: CalendarRsvpStatus;
  readonly responseNote: string | null;
  readonly respondedAt: string | null;
  readonly addedByUserId: number | null;
  readonly createdAt: string;
}

export interface CalendarEventReminderItemView {
  readonly id: number;
  readonly calendarEventId: number;
  readonly occurrenceStartAt: string;
  readonly minutesBefore: number;
  readonly remindAt: string;
  readonly channels: readonly string[];
  readonly status: CalendarReminderStatus;
  readonly notificationId: number | null;
  readonly recipientCount: number;
  readonly sentAt: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
}

export interface CalendarEventHistoryItemView {
  readonly id: number;
  readonly calendarEventId: number;
  readonly actionType: CalendarHistoryActionType;
  readonly changeSource: CalendarChangeSource;
  readonly actorUserId: number | null;
  readonly actorFullName: string | null;
  readonly changedFields: readonly string[];
  readonly beforeSnapshot: Record<string, unknown> | null;
  readonly afterSnapshot: Record<string, unknown> | null;
  readonly reason: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
}

export interface CalendarEventAccessEvaluation {
  readonly accessRole: CalendarAccessRole;
  readonly canView: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly canManageParticipants: boolean;
  readonly canRsvp: boolean;
  readonly matchedReasons: readonly string[];
}

export interface CalendarEventOccurrenceView {
  readonly occurrenceIndex: number;
  readonly eventId: number;
  readonly eventCode: string;
  readonly title: string;
  readonly eventType: CalendarEventType | string;
  readonly status: CalendarEventStatusCode;
  readonly statusName: CalendarEventStatusName;
  readonly startAt: string;
  readonly endAt: string;
  readonly isAllDay: boolean;
  readonly isRecurringInstance: boolean;
  readonly location: string | null;
  readonly resourceCode: string | null;
  readonly resourceName: string | null;
  readonly ownerUserId: number;
  readonly organizationUnitId: number | null;
}

export interface CalendarEventItemView {
  readonly id: number;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly eventType: CalendarEventType | string;
  readonly status: CalendarEventStatusCode;
  readonly statusName: CalendarEventStatusName;
  readonly visibility: CalendarVisibility;
  readonly startAt: string;
  readonly endAt: string;
  readonly durationMinutes: number;
  readonly timezone: string;
  readonly isAllDay: boolean;
  readonly location: string | null;
  readonly meetingUrl: string | null;
  readonly resourceCode: string | null;
  readonly resourceName: string | null;
  readonly ownerUserId: number;
  readonly ownerFullName: string | null;
  readonly organizationUnitId: number | null;
  readonly organizationUnitName: string | null;
  readonly isRecurring: boolean;
  readonly recurrenceRule: CalendarRecurrenceRule | null;
  readonly reminderRules: readonly CalendarReminderRule[];
  readonly externalBindings: CalendarExternalBindingsMap;
  readonly participantCount: number;
  readonly cancelReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CalendarEventDetailView extends CalendarEventItemView {
  readonly participants: readonly CalendarEventParticipantItemView[];
  readonly upcomingOccurrences: readonly CalendarEventOccurrenceView[];
  readonly reminders: readonly CalendarEventReminderItemView[];
  readonly histories: readonly CalendarEventHistoryItemView[];
  readonly viewerAccess: CalendarEventAccessEvaluation;
  readonly metadata: Record<string, unknown> | null;
}

export interface CalendarConflictItemView {
  readonly conflictType: CalendarConflictType;
  readonly conflictingEventId: number;
  readonly conflictingEventCode: string;
  readonly conflictingEventTitle: string;
  readonly overlapStartAt: string;
  readonly overlapEndAt: string;
  readonly resourceCode: string | null;
  readonly userId: number | null;
  readonly organizationUnitId: number | null;
  readonly message: string;
}

export interface CalendarConflictCheckResultView {
  readonly hasConflict: boolean;
  readonly resourceConflictCount: number;
  readonly participantConflictCount: number;
  readonly conflicts: readonly CalendarConflictItemView[];
}

export interface CalendarReminderScanResultView {
  readonly scannedAt: string;
  readonly dueReminderCount: number;
  readonly dispatchedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly dispatchedReminderIds: readonly number[];
}

export interface CalendarProviderStatusView {
  readonly provider: CalendarExternalProvider;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly defaultCalendarId: string;
  readonly autoSyncOnChange: boolean;
  readonly capabilities: readonly string[];
}

export interface CalendarExternalSyncResultView {
  readonly eventId: number;
  readonly eventCode: string;
  readonly syncedProviders: readonly CalendarExternalProvider[];
  readonly bindings: CalendarExternalBindingsMap;
}
