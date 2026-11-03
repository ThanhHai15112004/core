export interface CalendarRecurrenceRuleItem {
  readonly frequency: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  readonly interval: number;
  readonly count?: number | null;
  readonly until?: string | null;
}

export interface CalendarParticipantItem {
  readonly id: number;
  readonly participantType: 'USER' | 'ORGANIZATION_UNIT';
  readonly userId: number | null;
  readonly userFullName: string | null;
  readonly organizationUnitId: number | null;
  readonly organizationUnitName: string | null;
  readonly role: string;
  readonly canEdit: boolean;
  readonly rsvpStatus: string;
}

export interface CalendarHistoryItem {
  readonly id: number;
  readonly actionType: string;
  readonly changeSource: string;
  readonly actorUserId: number | null;
  readonly actorFullName: string | null;
  readonly changedFields: readonly string[];
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface CalendarOccurrenceItem {
  readonly occurrenceIndex: number;
  readonly eventId: number;
  readonly eventCode: string;
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly isRecurringInstance: boolean;
}

export interface CalendarEventItem {
  readonly id: number;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly eventType: string;
  readonly status: number;
  readonly statusName: string;
  readonly visibility: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly location: string | null;
  readonly resourceCode: string | null;
  readonly ownerUserId: number;
  readonly ownerFullName: string | null;
  readonly isRecurring: boolean;
  readonly recurrenceRule: CalendarRecurrenceRuleItem | null;
  readonly externalBindings: Record<string, unknown>;
  readonly participantCount: number;
}

export interface CalendarEventDetail extends CalendarEventItem {
  readonly participants: readonly CalendarParticipantItem[];
  readonly upcomingOccurrences: readonly CalendarOccurrenceItem[];
  readonly histories: readonly CalendarHistoryItem[];
  readonly viewerAccess: {
    readonly accessRole: string;
    readonly canView: boolean;
    readonly canEdit: boolean;
    readonly canDelete: boolean;
    readonly canRsvp: boolean;
  };
}

export interface CalendarProviderStatus {
  readonly provider: 'GOOGLE' | 'MICROSOFT';
  readonly displayName: string;
  readonly enabled: boolean;
  readonly defaultCalendarId: string;
}
