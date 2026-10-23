import type {
  NotificationDispatchDetailView,
  NotificationDispatchHistoryItemView,
  NotificationInboxItemView,
  NotificationPreferenceItemView,
  NotificationUnreadSummaryView,
  ResolvedNotificationRuntimeConfig,
} from '../types/notifications.types.js';

export type NotificationInboxItemResponse = NotificationInboxItemView;
export type NotificationUnreadSummaryResponse = NotificationUnreadSummaryView;
export type NotificationPreferenceItemResponse = NotificationPreferenceItemView;
export type NotificationDispatchHistoryItemResponse = NotificationDispatchHistoryItemView;
export type NotificationDispatchDetailResponse = NotificationDispatchDetailView;
export type NotificationRuntimeConfigResponse = ResolvedNotificationRuntimeConfig;

export interface NotificationReadStateMutationResponse {
  readonly id: number;
  readonly notificationId: number;
  readonly isRead: boolean;
  readonly readAt: string | null;
  readonly unreadCount: number;
}

export interface MarkAllNotificationsReadResponse {
  readonly updatedCount: number;
  readonly unreadCount: number;
}

export interface NotificationArchiveMutationResponse {
  readonly id: number;
  readonly notificationId: number;
  readonly inboxStatus: number;
  readonly inboxStatusName: string;
  readonly archivedAt: string | null;
  readonly unreadCount: number;
}

export interface NotificationDeleteFromInboxResponse {
  readonly deleted: true;
  readonly id: number;
  readonly notificationId: number;
  readonly unreadCount: number;
  readonly dispatchHistoryPreserved: true;
}
