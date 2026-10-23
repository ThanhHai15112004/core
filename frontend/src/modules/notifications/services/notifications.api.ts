import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  ListDispatchesFilterParams,
  ListInboxFilterParams,
  NotificationDispatchDetail,
  NotificationDispatchHistoryItem,
  NotificationInboxItem,
  NotificationPreferenceItem,
  NotificationRuntimeConfig,
  NotificationUnreadSummary,
  SendNotificationPayload,
} from '../types/notifications.types';

function buildInboxQueryString(params: ListInboxFilterParams): string {
  const sp = new URLSearchParams();
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  if (params.search) sp.set('search', params.search);
  if (params.inboxStatus !== undefined && params.inboxStatus !== '') {
    sp.set('inboxStatus', String(params.inboxStatus));
  }
  if (params.isRead !== undefined) sp.set('isRead', String(params.isRead));
  if (params.category !== undefined && params.category !== '') {
    sp.set('category', String(params.category));
  }
  if (params.priority !== undefined && params.priority !== '') {
    sp.set('priority', String(params.priority));
  }
  return sp.toString();
}

function buildDispatchesQueryString(params: ListDispatchesFilterParams): string {
  const sp = new URLSearchParams();
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  if (params.search) sp.set('search', params.search);
  if (params.category !== undefined && params.category !== '') {
    sp.set('category', String(params.category));
  }
  if (params.priority !== undefined && params.priority !== '') {
    sp.set('priority', String(params.priority));
  }
  if (params.targetType !== undefined && params.targetType !== '') {
    sp.set('targetType', String(params.targetType));
  }
  return sp.toString();
}

export const notificationsApi = {
  getConfig: (organizationUnitId?: number) => {
    const qs = organizationUnitId ? `organizationUnitId=${organizationUnitId}` : '';
    return fetchApi<NotificationRuntimeConfig>(API_ROUTES.NOTIFICATIONS.CONFIG(qs));
  },

  updateConfig: (payload: Partial<NotificationRuntimeConfig>) =>
    fetchApi<NotificationRuntimeConfig>(API_ROUTES.NOTIFICATIONS.CONFIG(), {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getUnreadSummary: () =>
    fetchApi<NotificationUnreadSummary>(API_ROUTES.NOTIFICATIONS.UNREAD_COUNT),

  listInbox: (params: ListInboxFilterParams = {}) =>
    fetchApiWithMeta<NotificationInboxItem[]>(
      API_ROUTES.NOTIFICATIONS.INBOX(buildInboxQueryString(params)),
    ),

  getInboxDetail: (id: number) =>
    fetchApi<NotificationInboxItem>(API_ROUTES.NOTIFICATIONS.INBOX_BY_ID(id)),

  setReadState: (id: number, isRead: boolean) =>
    fetchApi<{ id: number; notificationId: number; isRead: boolean; unreadCount: number }>(
      API_ROUTES.NOTIFICATIONS.INBOX_READ(id),
      {
        method: 'PATCH',
        body: JSON.stringify({ isRead }),
      },
    ),

  markAllAsRead: (category?: number | string) =>
    fetchApi<{ updatedCount: number; unreadCount: number }>(
      API_ROUTES.NOTIFICATIONS.INBOX_MARK_ALL_READ,
      {
        method: 'POST',
        body: JSON.stringify(category ? { category } : {}),
      },
    ),

  setArchiveState: (id: number, archived: boolean) =>
    fetchApi<{
      id: number;
      notificationId: number;
      inboxStatus: number;
      inboxStatusName: string;
      unreadCount: number;
    }>(API_ROUTES.NOTIFICATIONS.INBOX_ARCHIVE(id), {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    }),

  deleteFromInbox: (id: number) =>
    fetchApi<{
      deleted: true;
      id: number;
      notificationId: number;
      unreadCount: number;
      dispatchHistoryPreserved: true;
    }>(API_ROUTES.NOTIFICATIONS.INBOX_BY_ID(id), {
      method: 'DELETE',
    }),

  getPreferences: () =>
    fetchApi<NotificationPreferenceItem[]>(API_ROUTES.NOTIFICATIONS.PREFERENCES),

  updatePreferences: (
    preferences: Array<{
      category: number | string;
      inAppEnabled?: boolean;
      emailEnabled?: boolean;
      smsEnabled?: boolean;
      pushEnabled?: boolean;
      mutedUntil?: string | null;
    }>,
  ) =>
    fetchApi<NotificationPreferenceItem[]>(API_ROUTES.NOTIFICATIONS.PREFERENCES, {
      method: 'PUT',
      body: JSON.stringify({ preferences }),
    }),

  sendNotification: (payload: SendNotificationPayload) =>
    fetchApi<NotificationDispatchDetail>(API_ROUTES.NOTIFICATIONS.SEND, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listDispatches: (params: ListDispatchesFilterParams = {}) =>
    fetchApiWithMeta<NotificationDispatchHistoryItem[]>(
      API_ROUTES.NOTIFICATIONS.DISPATCHES(buildDispatchesQueryString(params)),
    ),

  getDispatchDetail: (id: number) =>
    fetchApi<NotificationDispatchDetail>(API_ROUTES.NOTIFICATIONS.DISPATCH_BY_ID(id)),
};

export const NOTIFICATION_UNREAD_CHANGED_EVENT = 'core:notification-unread-changed';

export function emitNotificationUnreadChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_UNREAD_CHANGED_EVENT));
  }
}

