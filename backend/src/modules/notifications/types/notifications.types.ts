import type {
  NotificationCategoryCode,
  NotificationCategoryName,
  NotificationChannelCode,
  NotificationChannelName,
  NotificationInboxStatusCode,
  NotificationInboxStatusName,
  NotificationPriorityCode,
  NotificationPriorityName,
  NotificationTargetTypeCode,
  NotificationTargetTypeName,
} from '../enum/notifications.enum.js';

export interface NotificationTargetPayload {
  readonly userIds?: readonly number[];
  readonly roleIds?: readonly number[];
  readonly roleCodes?: readonly string[];
  readonly organizationUnitIds?: readonly number[];
  readonly includeSubUnits?: boolean;
}

export interface DefaultCategoryChannelMatrixItem {
  readonly inApp: boolean;
  readonly email: boolean;
  readonly sms: boolean;
  readonly push: boolean;
}

export type DefaultCategoryChannelMatrix = Record<string, DefaultCategoryChannelMatrixItem>;

export interface ResolvedNotificationRuntimeConfig {
  readonly enabled: boolean;
  readonly inAppFeatureEnabled: boolean;
  readonly orgUnitModuleInstalled: boolean;
  readonly orgUnitTargetingEnabled: boolean;
  readonly orgUnitBroadcastFlagEnabled: boolean;
  readonly orgUnitIncludeSubUnitsDefault: boolean;
  readonly roleTargetingEnabled: boolean;
  readonly roleBroadcastFlagEnabled: boolean;
  readonly allowUserCustomization: boolean;
  readonly userPreferencesFlagEnabled: boolean;
  readonly lockSecurityInApp: boolean;
  readonly autoReadOnOpen: boolean;
  readonly retentionDays: number;
  readonly pollingIntervalSec: number;
  readonly maxRecipientsPerBatch: number;
  readonly maxTitleLength: number;
  readonly maxBodyLength: number;
  readonly paginationDefaultPageSize: number;
  readonly paginationMaxPageSize: number;
  readonly enabledChannels: readonly NotificationChannelName[];
  readonly defaultChannels: readonly NotificationChannelName[];
  readonly defaultPreferenceMatrix: DefaultCategoryChannelMatrix;
}

export interface NotificationPreferenceItemView {
  readonly category: NotificationCategoryCode;
  readonly categoryCode: NotificationCategoryName;
  readonly categoryLabel: string;
  readonly inAppEnabled: boolean;
  readonly emailEnabled: boolean;
  readonly smsEnabled: boolean;
  readonly pushEnabled: boolean;
  readonly isSecurityLockedInApp: boolean;
  readonly mutedUntil: string | null;
  readonly updatedAt: string | null;
}

export interface NotificationUnreadSummaryView {
  readonly unreadCount: number;
  readonly totalActiveCount: number;
  readonly totalArchivedCount: number;
  readonly byCategory: Record<string, number>;
}

export interface NotificationInboxItemView {
  readonly id: number;
  readonly notificationId: number;
  readonly code: string;
  readonly title: string;
  readonly content: string;
  readonly category: NotificationCategoryCode;
  readonly categoryName: NotificationCategoryName;
  readonly categoryLabel: string;
  readonly priority: NotificationPriorityCode;
  readonly priorityName: NotificationPriorityName;
  readonly priorityLabel: string;
  readonly targetType: NotificationTargetTypeCode;
  readonly targetTypeName: NotificationTargetTypeName;
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly isRead: boolean;
  readonly readAt: string | null;
  readonly inboxStatus: NotificationInboxStatusCode;
  readonly inboxStatusName: NotificationInboxStatusName;
  readonly archivedAt: string | null;
  readonly actionUrl: string | null;
  readonly referenceModule: string | null;
  readonly referenceType: string | null;
  readonly referenceId: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly senderUserId: number | null;
  readonly organizationUnitId: number | null;
  readonly deliveredAt: string;
  readonly dispatchedAt: string;
}

export interface NotificationDispatchHistoryItemView {
  readonly id: number;
  readonly code: string;
  readonly title: string;
  readonly content: string;
  readonly category: NotificationCategoryCode;
  readonly categoryName: NotificationCategoryName;
  readonly categoryLabel: string;
  readonly priority: NotificationPriorityCode;
  readonly priorityName: NotificationPriorityName;
  readonly priorityLabel: string;
  readonly targetType: NotificationTargetTypeCode;
  readonly targetTypeName: NotificationTargetTypeName;
  readonly targetTypeLabel: string;
  readonly targetPayload: NotificationTargetPayload;
  readonly channels: readonly NotificationChannelName[];
  readonly actionUrl: string | null;
  readonly referenceModule: string | null;
  readonly referenceType: string | null;
  readonly referenceId: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly senderUserId: number | null;
  readonly organizationUnitId: number | null;
  readonly totalTargeted: number;
  readonly totalDelivered: number;
  readonly totalSkippedByPref: number;
  readonly readCount: number;
  readonly archivedCount: number;
  readonly deletedFromInboxCount: number;
  readonly dispatchedAt: string;
  readonly createdAt: string;
}

export interface NotificationDispatchRecipientDetailView {
  readonly recipientEntryId: number;
  readonly recipientUserId: number;
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly isRead: boolean;
  readonly readAt: string | null;
  readonly inboxStatus: NotificationInboxStatusCode;
  readonly inboxStatusName: NotificationInboxStatusName;
  readonly archivedAt: string | null;
  readonly recipientDeletedAt: string | null;
  readonly deliveredAt: string;
}

export interface NotificationDispatchDetailView extends NotificationDispatchHistoryItemView {
  readonly recipients: readonly NotificationDispatchRecipientDetailView[];
}
