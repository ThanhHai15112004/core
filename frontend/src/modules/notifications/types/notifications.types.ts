export type NotificationCategoryName = 'SYSTEM' | 'WORK' | 'SECURITY' | 'ANNOUNCEMENT' | string;
export type NotificationPriorityName = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type NotificationTargetTypeName = 'SINGLE_USER' | 'USER_GROUP' | 'ROLE' | 'ORG_UNIT';
export type NotificationChannelName = 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';
export type NotificationInboxStatusName = 'ACTIVE' | 'ARCHIVED' | 'DELETED';

export interface NotificationUnreadSummary {
  unreadCount: number;
  totalActiveCount: number;
  totalArchivedCount: number;
  byCategory: Record<string, number>;
}

export interface NotificationInboxItem {
  id: number;
  notificationId: number;
  code: string;
  title: string;
  content: string;
  category: number;
  categoryName: NotificationCategoryName;
  categoryLabel: string;
  priority: number;
  priorityName: NotificationPriorityName;
  priorityLabel: string;
  targetType: number;
  targetTypeName: NotificationTargetTypeName;
  channel: number;
  channelName: NotificationChannelName;
  isRead: boolean;
  readAt: string | null;
  inboxStatus: number;
  inboxStatusName: NotificationInboxStatusName;
  archivedAt: string | null;
  actionUrl: string | null;
  referenceModule: string | null;
  referenceType: string | null;
  referenceId: string | null;
  metadata: Record<string, unknown> | null;
  senderUserId: number | null;
  organizationUnitId: number | null;
  deliveredAt: string;
  dispatchedAt: string;
}

export interface NotificationPreferenceItem {
  category: number;
  categoryCode: NotificationCategoryName;
  categoryLabel: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  isSecurityLockedInApp: boolean;
  mutedUntil: string | null;
  updatedAt: string | null;
}

export interface NotificationTargetPayload {
  userIds?: number[];
  roleIds?: number[];
  roleCodes?: string[];
  organizationUnitIds?: number[];
  includeSubUnits?: boolean;
}

export interface NotificationDispatchHistoryItem {
  id: number;
  code: string;
  title: string;
  content: string;
  category: number;
  categoryName: NotificationCategoryName;
  categoryLabel: string;
  priority: number;
  priorityName: NotificationPriorityName;
  priorityLabel: string;
  targetType: number;
  targetTypeName: NotificationTargetTypeName;
  targetTypeLabel: string;
  targetPayload: NotificationTargetPayload;
  channels: NotificationChannelName[];
  actionUrl: string | null;
  referenceModule: string | null;
  referenceType: string | null;
  referenceId: string | null;
  metadata: Record<string, unknown> | null;
  senderUserId: number | null;
  organizationUnitId: number | null;
  totalTargeted: number;
  totalDelivered: number;
  totalSkippedByPref: number;
  readCount: number;
  archivedCount: number;
  deletedFromInboxCount: number;
  dispatchedAt: string;
  createdAt: string;
}

export interface NotificationDispatchRecipientDetail {
  recipientEntryId: number;
  recipientUserId: number;
  channel: number;
  channelName: NotificationChannelName;
  isRead: boolean;
  readAt: string | null;
  inboxStatus: number;
  inboxStatusName: NotificationInboxStatusName;
  archivedAt: string | null;
  recipientDeletedAt: string | null;
  deliveredAt: string;
}

export interface NotificationDispatchDetail extends NotificationDispatchHistoryItem {
  recipients: NotificationDispatchRecipientDetail[];
}

export interface NotificationRuntimeConfig {
  enabled: boolean;
  inAppFeatureEnabled: boolean;
  orgUnitModuleInstalled: boolean;
  orgUnitTargetingEnabled: boolean;
  orgUnitBroadcastFlagEnabled: boolean;
  orgUnitIncludeSubUnitsDefault: boolean;
  roleTargetingEnabled: boolean;
  roleBroadcastFlagEnabled: boolean;
  allowUserCustomization: boolean;
  userPreferencesFlagEnabled: boolean;
  lockSecurityInApp: boolean;
  autoReadOnOpen: boolean;
  retentionDays: number;
  pollingIntervalSec: number;
  maxRecipientsPerBatch: number;
  maxTitleLength: number;
  maxBodyLength: number;
  paginationDefaultPageSize: number;
  paginationMaxPageSize: number;
  enabledChannels: NotificationChannelName[];
  defaultChannels: NotificationChannelName[];
  defaultPreferenceMatrix: Record<
    string,
    { inApp: boolean; email: boolean; sms: boolean; push: boolean }
  >;
}

export interface SendNotificationPayload {
  title: string;
  content: string;
  category?: number | string;
  priority?: number | string;
  targetType: number | string;
  userId?: number;
  userIds?: number[];
  roleIds?: number[];
  roleCodes?: string[];
  organizationUnitIds?: number[];
  includeSubUnits?: boolean;
  channels?: (number | string)[];
  actionUrl?: string | null;
  referenceModule?: string | null;
  organizationUnitId?: number | null;
  forceDeliver?: boolean;
}

export interface ListInboxFilterParams {
  page?: number;
  limit?: number;
  search?: string;
  inboxStatus?: number | string;
  isRead?: boolean;
  category?: number | string;
  priority?: number | string;
}

export interface ListDispatchesFilterParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: number | string;
  priority?: number | string;
  targetType?: number | string;
}

