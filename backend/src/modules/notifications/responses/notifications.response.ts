import type {
  NotificationDeliveryItemView,
  NotificationDispatchDetailView,
  NotificationDispatchHistoryItemView,
  NotificationInboxItemView,
  NotificationPreferenceItemView,
  NotificationPushSubscriptionItemView,
  NotificationQuotaAndCostSummaryView,
  NotificationSuppressionItemView,
  NotificationTemplateItemView,
  NotificationTemplatePreviewView,
  NotificationUnreadSummaryView,
  ResolvedNotificationRuntimeConfig,
} from '../types/notifications.types.js';

export type NotificationInboxItemResponse = NotificationInboxItemView;
export type NotificationUnreadSummaryResponse = NotificationUnreadSummaryView;
export type NotificationPreferenceItemResponse = NotificationPreferenceItemView;
export type NotificationDispatchHistoryItemResponse = NotificationDispatchHistoryItemView;
export type NotificationDispatchDetailResponse = NotificationDispatchDetailView;
export type NotificationRuntimeConfigResponse = ResolvedNotificationRuntimeConfig;
export type NotificationTemplateItemResponse = NotificationTemplateItemView;
export type NotificationTemplatePreviewResponse = NotificationTemplatePreviewView;
export type NotificationDeliveryItemResponse = NotificationDeliveryItemView;
export type NotificationSuppressionItemResponse = NotificationSuppressionItemView;
export type NotificationPushSubscriptionItemResponse = NotificationPushSubscriptionItemView;
export type NotificationQuotaAndCostSummaryResponse = NotificationQuotaAndCostSummaryView;

export interface RetryDueDeliveriesResponse {
  readonly scannedCount: number;
  readonly retriedCount: number;
  readonly succeededCount: number;
  readonly rescheduledCount: number;
  readonly permanentFailedCount: number;
  readonly items: readonly NotificationDeliveryItemView[];
}

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
