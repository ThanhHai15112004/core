import { defaultCodeRegistry, type PaginatedResult } from '@packages/kernel/index.js';
import type { MessageEnvelope } from '@packages/messaging/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import {
  getNotificationCategoryLabel,
  getNotificationCategoryName,
  getNotificationChannelName,
  parseNotificationCategory,
  parseNotificationChannel,
} from '@modules/templates/contracts/index.js';
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_AUDIT_META,
  NOTIFICATION_DELIVERY_CODE_TYPES,
  NOTIFICATION_DELIVERY_FEATURE_FLAG_KEYS,
  NOTIFICATION_DELIVERY_SETTING_KEYS,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_DOCUMENT_FORMAT,
  NOTIFICATION_ERROR_TYPE,
  NOTIFICATION_PUSH_PLATFORM,
  NOTIFICATION_SUPPRESSION_REASON,
  NOTIFICATION_TEMPLATE_TYPE,
  NOTIFICATION_TEMPLATE_VERSION_STATUS,
  type NotificationCategoryCode,
  type NotificationCategoryName,
  type NotificationChannelCode,
  type NotificationChannelName,
  type NotificationDeliveryStatusCode,
  type NotificationDeliveryStatusName,
  type NotificationDocumentFormatName,
  type NotificationErrorTypeCode,
  type NotificationErrorTypeName,
  type NotificationPushPlatformCode,
  type NotificationPushPlatformName,
  type NotificationSuppressionReasonCode,
  type NotificationSuppressionReasonName,
  type NotificationTemplateTypeName,
  type NotificationTemplateVersionStatusName,
} from '../enum/notification-delivery.enum.js';
import type {
  CreateNotificationSuppressionRequest,
  ListNotificationDeliveriesQuery,
  ListNotificationSuppressionsQuery,
  RegisterPushSubscriptionRequest,
  UpdateDeliveryStatusWebhookRequest,
} from '../requests/notification-delivery.requests.js';
import type {
  NotificationDeliveryItemResponse,
  NotificationPushSubscriptionItemResponse,
  NotificationQuotaAndCostSummaryResponse,
  NotificationSuppressionItemResponse,
  RetryDueDeliveriesResponse,
} from '../responses/notification-delivery.response.js';
import type {
  DefaultCategoryChannelMatrix,
  DefaultCategoryChannelMatrixItem,
  DispatchExternalChannelNotificationInput,
  DispatchExternalChannelRecipientEntryInput,
  NotificationBatchDeliverySummaryView,
  NotificationChannelQuotaItemView,
  NotificationDeliveryItemView,
  NotificationPushSubscriptionItemView,
  NotificationQuotaAndCostSummaryView,
  NotificationSuppressionItemView,
  ResolvedNotificationRuntimeConfig,
} from '../types/notification-delivery.types.js';

export {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_AUDIT_META,
  NOTIFICATION_DELIVERY_CODE_TYPES,
  NOTIFICATION_DELIVERY_FEATURE_FLAG_KEYS,
  NOTIFICATION_DELIVERY_SETTING_KEYS,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_DOCUMENT_FORMAT,
  NOTIFICATION_ERROR_TYPE,
  NOTIFICATION_PUSH_PLATFORM,
  NOTIFICATION_SUPPRESSION_REASON,
  NOTIFICATION_TEMPLATE_TYPE,
  NOTIFICATION_TEMPLATE_VERSION_STATUS,
  getNotificationCategoryLabel,
  getNotificationCategoryName,
  getNotificationChannelName,
  parseNotificationCategory,
  parseNotificationChannel,
  type DefaultCategoryChannelMatrix,
  type DefaultCategoryChannelMatrixItem,
  type DispatchExternalChannelNotificationInput,
  type DispatchExternalChannelRecipientEntryInput,
  type NotificationBatchDeliverySummaryView,
  type NotificationCategoryCode,
  type NotificationCategoryName,
  type NotificationChannelCode,
  type NotificationChannelName,
  type NotificationChannelQuotaItemView,
  type NotificationDeliveryItemView,
  type NotificationDeliveryStatusCode,
  type NotificationDeliveryStatusName,
  type NotificationDocumentFormatName,
  type NotificationErrorTypeCode,
  type NotificationErrorTypeName,
  type NotificationPushPlatformCode,
  type NotificationPushPlatformName,
  type NotificationPushSubscriptionItemView,
  type NotificationQuotaAndCostSummaryView,
  type NotificationSuppressionItemView,
  type NotificationSuppressionReasonCode,
  type NotificationSuppressionReasonName,
  type NotificationTemplateTypeName,
  type NotificationTemplateVersionStatusName,
  type ResolvedNotificationRuntimeConfig,
};

export function parseNotificationDeliveryStatus(val: unknown): NotificationDeliveryStatusCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    NOTIFICATION_DELIVERY_CODE_TYPES.DELIVERY_STATUS,
    val,
    NOTIFICATION_DELIVERY_STATUS.QUEUED,
  );
  if (
    resolved === NOTIFICATION_DELIVERY_STATUS.QUEUED ||
    resolved === NOTIFICATION_DELIVERY_STATUS.SENT ||
    resolved === NOTIFICATION_DELIVERY_STATUS.DELIVERED ||
    resolved === NOTIFICATION_DELIVERY_STATUS.FAILED ||
    resolved === NOTIFICATION_DELIVERY_STATUS.SUPPRESSED
  ) {
    return resolved;
  }
  return NOTIFICATION_DELIVERY_STATUS.QUEUED;
}

export function getNotificationDeliveryStatusName(code: number): NotificationDeliveryStatusName {
  const name = defaultCodeRegistry.getCodeName(
    NOTIFICATION_DELIVERY_CODE_TYPES.DELIVERY_STATUS,
    code,
    'QUEUED',
  );
  if (
    name === 'QUEUED' ||
    name === 'SENT' ||
    name === 'DELIVERED' ||
    name === 'FAILED' ||
    name === 'SUPPRESSED'
  ) {
    return name;
  }
  switch (code) {
    case NOTIFICATION_DELIVERY_STATUS.SENT:
      return 'SENT';
    case NOTIFICATION_DELIVERY_STATUS.DELIVERED:
      return 'DELIVERED';
    case NOTIFICATION_DELIVERY_STATUS.FAILED:
      return 'FAILED';
    case NOTIFICATION_DELIVERY_STATUS.SUPPRESSED:
      return 'SUPPRESSED';
    default:
      return 'QUEUED';
  }
}

export function getNotificationDeliveryStatusLabel(code: number, locale = 'vi'): string {
  return defaultCodeRegistry.getLabel(
    NOTIFICATION_DELIVERY_CODE_TYPES.DELIVERY_STATUS,
    code,
    locale,
  );
}

export function getNotificationErrorTypeName(code: number): NotificationErrorTypeName {
  switch (code) {
    case NOTIFICATION_ERROR_TYPE.TRANSIENT:
      return 'TRANSIENT';
    case NOTIFICATION_ERROR_TYPE.PERMANENT:
      return 'PERMANENT';
    case NOTIFICATION_ERROR_TYPE.RATE_LIMITED:
      return 'RATE_LIMITED';
    case NOTIFICATION_ERROR_TYPE.QUOTA_EXCEEDED:
      return 'QUOTA_EXCEEDED';
    case NOTIFICATION_ERROR_TYPE.SUPPRESSED:
      return 'SUPPRESSED';
    default:
      return 'NONE';
  }
}

export function parseNotificationSuppressionReason(
  val: unknown,
): NotificationSuppressionReasonCode {
  if (typeof val === 'number') {
    if (val >= 1 && val <= 6) return val as NotificationSuppressionReasonCode;
  }
  if (typeof val === 'string') {
    const upper = val.trim().toUpperCase();
    if (upper in NOTIFICATION_SUPPRESSION_REASON) {
      return NOTIFICATION_SUPPRESSION_REASON[upper as keyof typeof NOTIFICATION_SUPPRESSION_REASON];
    }
  }
  const resolved = defaultCodeRegistry.parseToNumericCode(
    NOTIFICATION_DELIVERY_CODE_TYPES.SUPPRESSION_REASON,
    val,
    NOTIFICATION_SUPPRESSION_REASON.MANUAL_BLOCK,
  );
  if (resolved >= 1 && resolved <= 6) {
    return resolved as NotificationSuppressionReasonCode;
  }
  return NOTIFICATION_SUPPRESSION_REASON.MANUAL_BLOCK;
}

export function getNotificationSuppressionReasonName(
  code: number,
): NotificationSuppressionReasonName {
  switch (code) {
    case NOTIFICATION_SUPPRESSION_REASON.HARD_BOUNCE:
      return 'HARD_BOUNCE';
    case NOTIFICATION_SUPPRESSION_REASON.INVALID_FORMAT:
      return 'INVALID_FORMAT';
    case NOTIFICATION_SUPPRESSION_REASON.UNREGISTERED_TOKEN:
      return 'UNREGISTERED_TOKEN';
    case NOTIFICATION_SUPPRESSION_REASON.UNSUBSCRIBED:
      return 'UNSUBSCRIBED';
    case NOTIFICATION_SUPPRESSION_REASON.SPAM_COMPLAINT:
      return 'SPAM_COMPLAINT';
    default:
      return 'MANUAL_BLOCK';
  }
}

export function getNotificationSuppressionReasonLabel(code: number, locale = 'vi'): string {
  return defaultCodeRegistry.getLabel(
    NOTIFICATION_DELIVERY_CODE_TYPES.SUPPRESSION_REASON,
    code,
    locale,
  );
}

export function parseNotificationPushPlatform(val: unknown): NotificationPushPlatformCode {
  if (
    val === 2 ||
    val === '2' ||
    String(val).toUpperCase() === 'FCM_ANDROID' ||
    String(val).toUpperCase() === 'FCM'
  ) {
    return NOTIFICATION_PUSH_PLATFORM.FCM_ANDROID;
  }
  if (
    val === 3 ||
    val === '3' ||
    String(val).toUpperCase() === 'APNS_IOS' ||
    String(val).toUpperCase() === 'APNS'
  ) {
    return NOTIFICATION_PUSH_PLATFORM.APNS_IOS;
  }
  return NOTIFICATION_PUSH_PLATFORM.WEB_PUSH;
}

export function getNotificationPushPlatformName(code: number): NotificationPushPlatformName {
  switch (code) {
    case NOTIFICATION_PUSH_PLATFORM.FCM_ANDROID:
      return 'FCM_ANDROID';
    case NOTIFICATION_PUSH_PLATFORM.APNS_IOS:
      return 'APNS_IOS';
    default:
      return 'WEB_PUSH';
  }
}

export interface INotificationDeliveryPublicService {
  resolveTemplateByCode(
    code: string,
    channel: NotificationChannelCode,
    locale?: string,
  ): Promise<{
    readonly code: string;
    readonly subjectTemplate: string | null;
    readonly bodyTemplate: string;
    readonly htmlTemplate: string | null;
  } | null>;
  dispatchExternalChannelDeliveries(params: {
    notification: DispatchExternalChannelNotificationInput;
    savedRecipients: readonly DispatchExternalChannelRecipientEntryInput[];
    recipientUserIds: readonly number[];
    templateCode?: string | null | undefined;
    templateVariables?: Record<string, unknown> | null | undefined;
    locale?: string | undefined;
    callerIdempotencyKey?: string | null | undefined;
    metadata?: Record<string, unknown> | null | undefined;
    runtimeConfig: ResolvedNotificationRuntimeConfig;
  }): Promise<{
    readonly deliveries: NotificationDeliveryItemView[];
    readonly summary: NotificationBatchDeliverySummaryView;
  }>;
  listDeliveries(
    query: ListNotificationDeliveriesQuery,
    locale?: string,
  ): Promise<PaginatedResult<NotificationDeliveryItemResponse>>;
  listDeliveriesForNotification(
    notificationId: number,
    locale?: string,
  ): Promise<NotificationDeliveryItemView[]>;
  retrySingleDelivery(
    deliveryId: number,
    actor?: UserIdentity,
    locale?: string,
  ): Promise<NotificationDeliveryItemResponse>;
  retryDueDeliveries(
    now?: Date,
    actor?: UserIdentity,
    locale?: string,
  ): Promise<RetryDueDeliveriesResponse>;
  updateDeliveryStatusWebhook(
    deliveryId: number,
    input: UpdateDeliveryStatusWebhookRequest,
    actor?: UserIdentity,
    locale?: string,
  ): Promise<NotificationDeliveryItemResponse>;
  listSuppressions(
    query: ListNotificationSuppressionsQuery,
    locale?: string,
  ): Promise<PaginatedResult<NotificationSuppressionItemResponse>>;
  addSuppression(
    input: CreateNotificationSuppressionRequest,
    actor?: UserIdentity,
    locale?: string,
  ): Promise<NotificationSuppressionItemResponse>;
  removeSuppression(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly removed: boolean; readonly id: number }>;
  listUserPushSubscriptions(userId: number): Promise<NotificationPushSubscriptionItemResponse[]>;
  registerPushSubscription(
    userId: number,
    input: RegisterPushSubscriptionRequest,
    actor?: UserIdentity,
  ): Promise<NotificationPushSubscriptionItemResponse>;
  unregisterPushSubscription(
    userId: number,
    subscriptionId: number,
    actor?: UserIdentity,
  ): Promise<{ readonly removed: true; readonly id: number }>;
  getQuotaAndCostSummary(
    organizationUnitId?: number | null,
    now?: Date,
  ): Promise<NotificationQuotaAndCostSummaryResponse>;
  enqueueChannelJob(input: {
    readonly channel: string;
    readonly templateCode?: string | null;
    readonly category?: number | string;
    readonly isCritical?: boolean;
    readonly recipients: readonly {
      readonly userId?: number | null;
      readonly recipientAddress: string;
    }[];
    readonly batchSize?: number;
    readonly idempotencyKey?: string;
    readonly maxAttempts?: number;
    readonly timeoutMs?: number;
  }): Promise<MessageEnvelope<{
    readonly channel: string;
    readonly templateCode: string | null;
    readonly recipients: readonly {
      readonly userId?: number | null;
      readonly recipientAddress: string;
    }[];
    readonly batchSize: number;
  }> | null>;
}

export const NOTIFICATION_DELIVERY_PUBLIC_SERVICE = Symbol('NOTIFICATION_DELIVERY_PUBLIC_SERVICE');
