import { defaultCodeRegistry } from '@packages/kernel/index.js';
import {
  NOTIFICATIONS_AUDIT_META,
  NOTIFICATIONS_CODE_TYPES,
  NOTIFICATIONS_FEATURE_FLAG_KEYS,
  NOTIFICATIONS_SEQUENCE_KEYS,
  NOTIFICATIONS_SETTING_KEYS,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_DISPATCH_STATUS,
  NOTIFICATION_ERROR_TYPE,
  NOTIFICATION_INBOX_STATUS,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_PUSH_PLATFORM,
  NOTIFICATION_SUPPRESSION_REASON,
  NOTIFICATION_TARGET_TYPE,
  type NotificationCategoryCode,
  type NotificationCategoryName,
  type NotificationChannelCode,
  type NotificationChannelName,
  type NotificationDeliveryStatusCode,
  type NotificationDeliveryStatusName,
  type NotificationDispatchStatusCode,
  type NotificationDispatchStatusName,
  type NotificationErrorTypeCode,
  type NotificationErrorTypeName,
  type NotificationInboxStatusCode,
  type NotificationInboxStatusName,
  type NotificationPriorityCode,
  type NotificationPriorityName,
  type NotificationPushPlatformCode,
  type NotificationPushPlatformName,
  type NotificationSuppressionReasonCode,
  type NotificationSuppressionReasonName,
  type NotificationTargetTypeCode,
  type NotificationTargetTypeName,
} from '../enum/notifications.enum.js';
import type {
  NotificationBatchDeliverySummaryView,
  NotificationChannelQuotaItemView,
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

export {
  NOTIFICATIONS_AUDIT_META,
  NOTIFICATIONS_CODE_TYPES,
  NOTIFICATIONS_FEATURE_FLAG_KEYS,
  NOTIFICATIONS_SEQUENCE_KEYS,
  NOTIFICATIONS_SETTING_KEYS,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_DISPATCH_STATUS,
  NOTIFICATION_ERROR_TYPE,
  NOTIFICATION_INBOX_STATUS,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_PUSH_PLATFORM,
  NOTIFICATION_SUPPRESSION_REASON,
  NOTIFICATION_TARGET_TYPE,
  type NotificationCategoryCode,
  type NotificationCategoryName,
  type NotificationChannelCode,
  type NotificationChannelName,
  type NotificationDeliveryStatusCode,
  type NotificationDeliveryStatusName,
  type NotificationDispatchStatusCode,
  type NotificationDispatchStatusName,
  type NotificationErrorTypeCode,
  type NotificationErrorTypeName,
  type NotificationInboxStatusCode,
  type NotificationInboxStatusName,
  type NotificationPriorityCode,
  type NotificationPriorityName,
  type NotificationPushPlatformCode,
  type NotificationPushPlatformName,
  type NotificationSuppressionReasonCode,
  type NotificationSuppressionReasonName,
  type NotificationTargetTypeCode,
  type NotificationTargetTypeName,
  type NotificationBatchDeliverySummaryView,
  type NotificationChannelQuotaItemView,
  type NotificationDeliveryItemView,
  type NotificationDispatchDetailView,
  type NotificationDispatchHistoryItemView,
  type NotificationInboxItemView,
  type NotificationPreferenceItemView,
  type NotificationPushSubscriptionItemView,
  type NotificationQuotaAndCostSummaryView,
  type NotificationSuppressionItemView,
  type NotificationTemplateItemView,
  type NotificationTemplatePreviewView,
  type NotificationUnreadSummaryView,
  type ResolvedNotificationRuntimeConfig,
};

export function parseNotificationCategory(val: unknown): NotificationCategoryCode {
  return defaultCodeRegistry.parseToNumericCode(
    NOTIFICATIONS_CODE_TYPES.CATEGORY,
    val,
    NOTIFICATION_CATEGORY.SYSTEM,
  );
}

export function getNotificationCategoryName(code: number): NotificationCategoryName {
  return defaultCodeRegistry.getCodeName(
    NOTIFICATIONS_CODE_TYPES.CATEGORY,
    code,
    'SYSTEM',
  ) as NotificationCategoryName;
}

export function getNotificationCategoryLabel(code: number, locale = 'vi'): string {
  return defaultCodeRegistry.getLabel(NOTIFICATIONS_CODE_TYPES.CATEGORY, code, locale);
}

export function parseNotificationPriority(val: unknown): NotificationPriorityCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    NOTIFICATIONS_CODE_TYPES.PRIORITY,
    val,
    NOTIFICATION_PRIORITY.NORMAL,
  );
  if (
    resolved === NOTIFICATION_PRIORITY.LOW ||
    resolved === NOTIFICATION_PRIORITY.NORMAL ||
    resolved === NOTIFICATION_PRIORITY.HIGH ||
    resolved === NOTIFICATION_PRIORITY.URGENT
  ) {
    return resolved;
  }
  return NOTIFICATION_PRIORITY.NORMAL;
}

export function getNotificationPriorityName(code: number): NotificationPriorityName {
  const name = defaultCodeRegistry.getCodeName(NOTIFICATIONS_CODE_TYPES.PRIORITY, code, 'NORMAL');
  if (name === 'LOW' || name === 'NORMAL' || name === 'HIGH' || name === 'URGENT') {
    return name;
  }
  return 'NORMAL';
}

export function getNotificationPriorityLabel(code: number, locale = 'vi'): string {
  return defaultCodeRegistry.getLabel(NOTIFICATIONS_CODE_TYPES.PRIORITY, code, locale);
}

export function parseNotificationTargetType(val: unknown): NotificationTargetTypeCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    NOTIFICATIONS_CODE_TYPES.TARGET_TYPE,
    val,
    NOTIFICATION_TARGET_TYPE.SINGLE_USER,
  );
  if (
    resolved === NOTIFICATION_TARGET_TYPE.SINGLE_USER ||
    resolved === NOTIFICATION_TARGET_TYPE.USER_GROUP ||
    resolved === NOTIFICATION_TARGET_TYPE.ROLE ||
    resolved === NOTIFICATION_TARGET_TYPE.ORG_UNIT
  ) {
    return resolved;
  }
  return NOTIFICATION_TARGET_TYPE.SINGLE_USER;
}

export function getNotificationTargetTypeName(code: number): NotificationTargetTypeName {
  const name = defaultCodeRegistry.getCodeName(
    NOTIFICATIONS_CODE_TYPES.TARGET_TYPE,
    code,
    'SINGLE_USER',
  );
  if (name === 'SINGLE_USER' || name === 'USER_GROUP' || name === 'ROLE' || name === 'ORG_UNIT') {
    return name;
  }
  return 'SINGLE_USER';
}

export function getNotificationTargetTypeLabel(code: number, locale = 'vi'): string {
  return defaultCodeRegistry.getLabel(NOTIFICATIONS_CODE_TYPES.TARGET_TYPE, code, locale);
}

export function parseNotificationChannel(val: unknown): NotificationChannelCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    NOTIFICATIONS_CODE_TYPES.CHANNEL,
    val,
    NOTIFICATION_CHANNEL.IN_APP,
  );
  if (
    resolved === NOTIFICATION_CHANNEL.IN_APP ||
    resolved === NOTIFICATION_CHANNEL.EMAIL ||
    resolved === NOTIFICATION_CHANNEL.SMS ||
    resolved === NOTIFICATION_CHANNEL.PUSH
  ) {
    return resolved;
  }
  return NOTIFICATION_CHANNEL.IN_APP;
}

export function getNotificationChannelName(code: number): NotificationChannelName {
  const name = defaultCodeRegistry.getCodeName(NOTIFICATIONS_CODE_TYPES.CHANNEL, code, 'IN_APP');
  if (name === 'IN_APP' || name === 'EMAIL' || name === 'SMS' || name === 'PUSH') {
    return name;
  }
  return 'IN_APP';
}

export function parseNotificationInboxStatus(val: unknown): NotificationInboxStatusCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    NOTIFICATIONS_CODE_TYPES.INBOX_STATUS,
    val,
    NOTIFICATION_INBOX_STATUS.ACTIVE,
  );
  if (
    resolved === NOTIFICATION_INBOX_STATUS.ACTIVE ||
    resolved === NOTIFICATION_INBOX_STATUS.ARCHIVED ||
    resolved === NOTIFICATION_INBOX_STATUS.DELETED
  ) {
    return resolved;
  }
  return NOTIFICATION_INBOX_STATUS.ACTIVE;
}

export function getNotificationInboxStatusName(code: number): NotificationInboxStatusName {
  const name = defaultCodeRegistry.getCodeName(
    NOTIFICATIONS_CODE_TYPES.INBOX_STATUS,
    code,
    'ACTIVE',
  );
  if (name === 'ACTIVE' || name === 'ARCHIVED' || name === 'DELETED') {
    return name;
  }
  return 'ACTIVE';
}

export function parseNotificationDeliveryStatus(val: unknown): NotificationDeliveryStatusCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    NOTIFICATIONS_CODE_TYPES.DELIVERY_STATUS,
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
    NOTIFICATIONS_CODE_TYPES.DELIVERY_STATUS,
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
  return defaultCodeRegistry.getLabel(NOTIFICATIONS_CODE_TYPES.DELIVERY_STATUS, code, locale);
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
    NOTIFICATIONS_CODE_TYPES.SUPPRESSION_REASON,
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
  return defaultCodeRegistry.getLabel(NOTIFICATIONS_CODE_TYPES.SUPPRESSION_REASON, code, locale);
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

export interface DispatchNotificationPublicInput {
  readonly title?: string | undefined;
  readonly content?: string | undefined;
  readonly templateCode?: string | null | undefined;
  readonly templateVariables?: Record<string, unknown> | null | undefined;
  readonly locale?: string | undefined;
  readonly idempotencyKey?: string | null | undefined;
  readonly category?: NotificationCategoryCode | NotificationCategoryName | undefined;
  readonly priority?: NotificationPriorityCode | NotificationPriorityName | undefined;
  readonly targetType: NotificationTargetTypeCode | NotificationTargetTypeName;
  readonly userId?: number | undefined;
  readonly userIds?: readonly number[] | undefined;
  readonly roleIds?: readonly number[] | undefined;
  readonly roleCodes?: readonly string[] | undefined;
  readonly organizationUnitIds?: readonly number[] | undefined;
  readonly includeSubUnits?: boolean | undefined;
  readonly channels?: readonly (NotificationChannelCode | NotificationChannelName)[] | undefined;
  readonly actionUrl?: string | null | undefined;
  readonly referenceModule?: string | null | undefined;
  readonly referenceType?: string | null | undefined;
  readonly referenceId?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
  readonly senderUserId?: number | null | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly forceDeliver?: boolean | undefined;
}

export interface INotificationsPublicService {
  dispatch(input: DispatchNotificationPublicInput): Promise<NotificationDispatchDetailView>;
  getUnreadSummary(userId: number): Promise<NotificationUnreadSummaryView>;
  getUserPreferences(
    userId: number,
    organizationUnitId?: number | null,
  ): Promise<NotificationPreferenceItemView[]>;
  getRuntimeConfig(organizationUnitId?: number | null): ResolvedNotificationRuntimeConfig;
}

export const NOTIFICATIONS_PUBLIC_SERVICE = Symbol('NOTIFICATIONS_PUBLIC_SERVICE');
