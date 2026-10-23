import { defaultCodeRegistry } from '@packages/kernel/index.js';
import {
  NOTIFICATIONS_AUDIT_META,
  NOTIFICATIONS_CODE_TYPES,
  NOTIFICATIONS_FEATURE_FLAG_KEYS,
  NOTIFICATIONS_SEQUENCE_KEYS,
  NOTIFICATIONS_SETTING_KEYS,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DISPATCH_STATUS,
  NOTIFICATION_INBOX_STATUS,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
  type NotificationCategoryCode,
  type NotificationCategoryName,
  type NotificationChannelCode,
  type NotificationChannelName,
  type NotificationDispatchStatusCode,
  type NotificationDispatchStatusName,
  type NotificationInboxStatusCode,
  type NotificationInboxStatusName,
  type NotificationPriorityCode,
  type NotificationPriorityName,
  type NotificationTargetTypeCode,
  type NotificationTargetTypeName,
} from '../enum/notifications.enum.js';
import type {
  NotificationDispatchDetailView,
  NotificationDispatchHistoryItemView,
  NotificationInboxItemView,
  NotificationPreferenceItemView,
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
  NOTIFICATION_DISPATCH_STATUS,
  NOTIFICATION_INBOX_STATUS,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
  type NotificationCategoryCode,
  type NotificationCategoryName,
  type NotificationChannelCode,
  type NotificationChannelName,
  type NotificationDispatchStatusCode,
  type NotificationDispatchStatusName,
  type NotificationInboxStatusCode,
  type NotificationInboxStatusName,
  type NotificationPriorityCode,
  type NotificationPriorityName,
  type NotificationTargetTypeCode,
  type NotificationTargetTypeName,
  type NotificationDispatchDetailView,
  type NotificationDispatchHistoryItemView,
  type NotificationInboxItemView,
  type NotificationPreferenceItemView,
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

export interface DispatchNotificationPublicInput {
  readonly title: string;
  readonly content: string;
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
