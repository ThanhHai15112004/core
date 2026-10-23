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
  emailFeatureEnabled?: boolean;
  smsFeatureEnabled?: boolean;
  pushFeatureEnabled?: boolean;
  emailProvider?: string;
  emailFromAddress?: string;
  emailFromName?: string;
  smsProvider?: string;
  smsSenderId?: string;
  pushProvider?: string;
  dispatchBatchSize?: number;
  dispatchRateLimitPerSec?: number;
  retryEnabled?: boolean;
  retryMaxAttempts?: number;
  retryBaseDelaySec?: number;
  autoSuppressOnPermanentFailure?: boolean;
  quotaCurrency?: string;
  quotaHardStopOnExceed?: boolean;
  smsDailyQuota?: number;
  smsMonthlyBudget?: number;
  smsCostPerSegment?: number;
  emailDailyQuota?: number;
  emailCostPerMessage?: number;
  pushDailyQuota?: number;
  pushCostPerMessage?: number;
}

export interface SendNotificationPayload {
  title?: string;
  content?: string;
  templateCode?: string | null;
  templateVariables?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
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

export interface NotificationTemplateItem {
  id: number;
  code: string;
  name: string;
  channel: number;
  channelName: NotificationChannelName;
  category: number;
  categoryName: NotificationCategoryName;
  locale: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  htmlTemplate: string | null;
  variables: string[];
  isActive: boolean;
  isSystem: boolean;
}

export interface NotificationDeliveryItem {
  id: number;
  notificationId: number;
  recipientUserId: number;
  channel: number;
  channelName: NotificationChannelName;
  providerCode: string;
  destination: string;
  templateCode: string | null;
  renderedSubject: string | null;
  renderedBody: string;
  idempotencyKey: string;
  batchKey: string | null;
  status: number;
  statusName: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED';
  statusLabel: string;
  errorTypeName: string;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  providerMessageId: string | null;
  segmentsCount: number;
  estimatedCost: number;
  currency: string;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
}

export interface NotificationSuppressionItem {
  id: number;
  channel: number;
  channelName: NotificationChannelName;
  destination: string;
  reason: number;
  reasonName: string;
  reasonLabel: string;
  providerCode: string | null;
  errorMessage: string | null;
  isActive: boolean;
  suppressedAt: string;
}

export interface NotificationPushSubscriptionItem {
  id: number;
  userId: number;
  platform: number;
  platformName: string;
  deviceToken: string;
  endpoint: string | null;
  deviceName: string | null;
  isActive: boolean;
  failureReason: string | null;
  createdAt: string;
}

export interface NotificationChannelQuotaItem {
  channel: number;
  channelName: NotificationChannelName;
  providerCode: string;
  dailySent: number;
  dailyDelivered: number;
  dailyFailed: number;
  dailySuppressed: number;
  dailySegments: number;
  dailyCost: number;
  dailyQuotaLimit: number;
  dailyUsagePercent: number;
  monthlySent: number;
  monthlySegments: number;
  monthlyCost: number;
  monthlyBudgetLimit: number;
  monthlyBudgetPercent: number;
  isQuotaExceeded: boolean;
  currency: string;
}

export interface NotificationQuotaSummary {
  currency: string;
  hardStopOnExceed: boolean;
  totalDailyCost: number;
  totalMonthlyCost: number;
  totalDailySmsSegments: number;
  totalMonthlySmsSegments: number;
  channels: NotificationChannelQuotaItem[];
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

