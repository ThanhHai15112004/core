import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  CalendarEventDetail,
  CalendarEventItem,
  CalendarProviderStatus,
} from '../types/calendar.types';

export const calendarApi = {
  listEvents: (qs = '') =>
    fetchApiWithMeta<CalendarEventItem[]>(API_ROUTES.CALENDAR.EVENTS(qs)),

  getEventById: (id: number): Promise<CalendarEventDetail> =>
    fetchApi<CalendarEventDetail>(API_ROUTES.CALENDAR.EVENT_BY_ID(id)),

  createEvent: (payload: Record<string, unknown>): Promise<CalendarEventDetail> =>
    fetchApi<CalendarEventDetail>(API_ROUTES.CALENDAR.EVENTS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  syncExternal: (
    id: number,
    providers: readonly ('GOOGLE' | 'MICROSOFT')[],
  ): Promise<unknown> =>
    fetchApi(API_ROUTES.CALENDAR.EVENT_SYNC_EXTERNAL(id), {
      method: 'POST',
      body: JSON.stringify({ providers }),
    }),

  scanReminders: (): Promise<{
    scannedAt: string;
    dueReminderCount: number;
    dispatchedCount: number;
  }> =>
    fetchApi(API_ROUTES.CALENDAR.REMINDERS_SCAN, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  listProviders: (): Promise<CalendarProviderStatus[]> =>
    fetchApi<CalendarProviderStatus[]>(API_ROUTES.CALENDAR.INTEGRATION_PROVIDERS),
};
