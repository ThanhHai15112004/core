import type {
  NotificationDeliveryItemView,
  NotificationPushSubscriptionItemView,
  NotificationQuotaAndCostSummaryView,
  NotificationSuppressionItemView,
} from '../types/notification-delivery.types.js';

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
