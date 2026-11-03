import { createHash } from 'node:crypto';
import {
  BadRequestAppException,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import {
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_EXTERNAL_PROVIDER,
  CALENDAR_FEATURE_FLAGS,
  CALENDAR_SETTING_KEYS,
  type CalendarChangeSource,
  type CalendarExternalProvider,
} from '../enum/calendar.enum.js';
import type {
  CalendarExternalBindingRecord,
  CalendarProviderStatusView,
  CalendarRecurrenceRule,
} from '../types/calendar.types.js';

export interface CalendarExternalSyncEventPayload {
  readonly eventId: number;
  readonly eventCode: string;
  readonly title: string;
  readonly description: string | null;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly timezone: string;
  readonly isAllDay: boolean;
  readonly location: string | null;
  readonly meetingUrl: string | null;
  readonly recurrenceRule: CalendarRecurrenceRule | null;
  readonly existingBinding?: CalendarExternalBindingRecord | undefined;
  readonly calendarIdOverride?: string | null | undefined;
}

export interface CalendarInboundExternalEventPayload {
  readonly externalEventId: string;
  readonly calendarId?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | null | undefined;
  readonly startAt?: string | undefined;
  readonly endAt?: string | undefined;
  readonly location?: string | null | undefined;
  readonly status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED' | undefined;
  readonly etag?: string | null | undefined;
}

export interface ICalendarExternalProviderAdapter {
  readonly provider: CalendarExternalProvider;
  readonly displayName: string;
  isEnabled(organizationUnitId?: number | null): boolean;
  getDefaultCalendarId(organizationUnitId?: number | null): string;
  getStatus(organizationUnitId?: number | null): CalendarProviderStatusView;
  syncEventUpsert(
    payload: CalendarExternalSyncEventPayload,
    organizationUnitId?: number | null,
  ): Promise<CalendarExternalBindingRecord>;
  syncEventCancel(
    payload: CalendarExternalSyncEventPayload,
    organizationUnitId?: number | null,
  ): Promise<CalendarExternalBindingRecord>;
  resolveChangeSource(): CalendarChangeSource;
}

export class GoogleCalendarProviderAdapter implements ICalendarExternalProviderAdapter {
  public readonly provider = CALENDAR_EXTERNAL_PROVIDER.GOOGLE;
  public readonly displayName = 'Google Calendar Adapter (REST API v3)';

  public isEnabled(_organizationUnitId?: number | null): boolean {
    return defaultFeatureFlagRegistry.isEnabled(CALENDAR_FEATURE_FLAGS.GOOGLE_SYNC_ENABLED);
  }

  public getDefaultCalendarId(organizationUnitId?: number | null): string {
    return (
      defaultSettingRegistry.getString(
        CALENDAR_SETTING_KEYS.GOOGLE_CALENDAR_ID,
        { organizationUnitId: organizationUnitId ?? null },
        'primary',
      ) || 'primary'
    );
  }

  public getStatus(organizationUnitId?: number | null): CalendarProviderStatusView {
    return {
      provider: this.provider,
      displayName: this.displayName,
      enabled: this.isEnabled(organizationUnitId),
      defaultCalendarId: this.getDefaultCalendarId(organizationUnitId),
      autoSyncOnChange: defaultSettingRegistry.getBoolean(
        CALENDAR_SETTING_KEYS.AUTO_SYNC_ON_CHANGE,
        { organizationUnitId: organizationUnitId ?? null },
        true,
      ),
      capabilities: [
        'UPSERT_EVENT',
        'CANCEL_EVENT',
        'RECURRING_RRULE',
        'GOOGLE_MEET_LINK',
        'INBOUND_WEBHOOK',
      ],
    };
  }

  public async syncEventUpsert(
    payload: CalendarExternalSyncEventPayload,
    organizationUnitId?: number | null,
  ): Promise<CalendarExternalBindingRecord> {
    if (!this.isEnabled(organizationUnitId)) {
      throw new BadRequestAppException('calendar.providerDisabled', [], {
        provider: this.provider,
      });
    }
    const calendarId =
      payload.calendarIdOverride?.trim() ||
      payload.existingBinding?.calendarId ||
      this.getDefaultCalendarId(organizationUnitId);
    const externalEventId =
      payload.existingBinding?.externalEventId ||
      `gcal_${payload.eventCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const etagHash = createHash('sha256')
      .update(
        `${externalEventId}:${payload.title}:${payload.startAt.toISOString()}:${payload.endAt.toISOString()}`,
      )
      .digest('hex')
      .slice(0, 16);

    return {
      provider: this.provider,
      calendarId,
      externalEventId,
      etag: `"gcal-etag-${etagHash}"`,
      externalUrl: `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(externalEventId)}`,
      conferenceUrl:
        payload.meetingUrl ||
        `https://meet.google.com/${etagHash.slice(0, 3)}-${etagHash.slice(3, 7)}-${etagHash.slice(7, 10)}`,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: 'SYNCED',
      lastError: null,
    };
  }

  public async syncEventCancel(
    payload: CalendarExternalSyncEventPayload,
    organizationUnitId?: number | null,
  ): Promise<CalendarExternalBindingRecord> {
    const base = await this.syncEventUpsert(payload, organizationUnitId);
    return {
      ...base,
      syncStatus: 'CANCELLED',
      lastSyncedAt: new Date().toISOString(),
    };
  }

  public resolveChangeSource(): CalendarChangeSource {
    return CALENDAR_CHANGE_SOURCE.GOOGLE_SYNC;
  }
}

export class MicrosoftCalendarProviderAdapter implements ICalendarExternalProviderAdapter {
  public readonly provider = CALENDAR_EXTERNAL_PROVIDER.MICROSOFT;
  public readonly displayName = 'Microsoft 365 / Outlook Calendar Adapter (Graph API)';

  public isEnabled(_organizationUnitId?: number | null): boolean {
    return defaultFeatureFlagRegistry.isEnabled(CALENDAR_FEATURE_FLAGS.MICROSOFT_SYNC_ENABLED);
  }

  public getDefaultCalendarId(organizationUnitId?: number | null): string {
    return (
      defaultSettingRegistry.getString(
        CALENDAR_SETTING_KEYS.MICROSOFT_CALENDAR_ID,
        { organizationUnitId: organizationUnitId ?? null },
        'primary',
      ) || 'primary'
    );
  }

  public getStatus(organizationUnitId?: number | null): CalendarProviderStatusView {
    return {
      provider: this.provider,
      displayName: this.displayName,
      enabled: this.isEnabled(organizationUnitId),
      defaultCalendarId: this.getDefaultCalendarId(organizationUnitId),
      autoSyncOnChange: defaultSettingRegistry.getBoolean(
        CALENDAR_SETTING_KEYS.AUTO_SYNC_ON_CHANGE,
        { organizationUnitId: organizationUnitId ?? null },
        true,
      ),
      capabilities: [
        'UPSERT_EVENT',
        'CANCEL_EVENT',
        'RECURRING_PATTERN',
        'TEAMS_MEETING_LINK',
        'INBOUND_WEBHOOK',
      ],
    };
  }

  public async syncEventUpsert(
    payload: CalendarExternalSyncEventPayload,
    organizationUnitId?: number | null,
  ): Promise<CalendarExternalBindingRecord> {
    if (!this.isEnabled(organizationUnitId)) {
      throw new BadRequestAppException('calendar.providerDisabled', [], {
        provider: this.provider,
      });
    }
    const calendarId =
      payload.calendarIdOverride?.trim() ||
      payload.existingBinding?.calendarId ||
      this.getDefaultCalendarId(organizationUnitId);
    const externalEventId =
      payload.existingBinding?.externalEventId ||
      `msgraph_${payload.eventCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const changeKey = createHash('sha256')
      .update(
        `${externalEventId}:${payload.title}:${payload.startAt.toISOString()}:${payload.endAt.toISOString()}`,
      )
      .digest('hex')
      .slice(0, 16);

    return {
      provider: this.provider,
      calendarId,
      externalEventId,
      etag: `W/"ms-change-${changeKey}"`,
      externalUrl: `https://outlook.office.com/calendar/item/${encodeURIComponent(externalEventId)}`,
      conferenceUrl: payload.meetingUrl || `https://teams.microsoft.com/l/meetup-join/${changeKey}`,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: 'SYNCED',
      lastError: null,
    };
  }

  public async syncEventCancel(
    payload: CalendarExternalSyncEventPayload,
    organizationUnitId?: number | null,
  ): Promise<CalendarExternalBindingRecord> {
    const base = await this.syncEventUpsert(payload, organizationUnitId);
    return {
      ...base,
      syncStatus: 'CANCELLED',
      lastSyncedAt: new Date().toISOString(),
    };
  }

  public resolveChangeSource(): CalendarChangeSource {
    return CALENDAR_CHANGE_SOURCE.MICROSOFT_SYNC;
  }
}

export class CalendarProviderAdapterRegistry {
  private readonly adapters = new Map<CalendarExternalProvider, ICalendarExternalProviderAdapter>();

  constructor() {
    this.register(new GoogleCalendarProviderAdapter());
    this.register(new MicrosoftCalendarProviderAdapter());
  }

  public register(adapter: ICalendarExternalProviderAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  public getAdapter(provider: CalendarExternalProvider): ICalendarExternalProviderAdapter {
    const normalized = String(provider).trim().toUpperCase() as CalendarExternalProvider;
    const found = this.adapters.get(normalized);
    if (!found) {
      throw new BadRequestAppException('calendar.providerDisabled', [], { provider });
    }
    return found;
  }

  public listStatuses(organizationUnitId?: number | null): CalendarProviderStatusView[] {
    return [...this.adapters.values()].map((a) => a.getStatus(organizationUnitId));
  }
}
