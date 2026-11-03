import type {
  NotificationCategoryCode,
  NotificationCategoryName,
  NotificationChannelCode,
  NotificationChannelName,
  NotificationDeliveryStatusCode,
  NotificationDeliveryStatusName,
  NotificationDocumentFormatName,
  NotificationErrorTypeCode,
  NotificationErrorTypeName,
  NotificationInboxStatusCode,
  NotificationInboxStatusName,
  NotificationPriorityCode,
  NotificationPriorityName,
  NotificationPushPlatformCode,
  NotificationPushPlatformName,
  NotificationSuppressionReasonCode,
  NotificationSuppressionReasonName,
  NotificationTargetTypeCode,
  NotificationTargetTypeName,
  NotificationTemplateTypeName,
  NotificationTemplateVersionStatusName,
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
  readonly emailFeatureEnabled: boolean;
  readonly smsFeatureEnabled: boolean;
  readonly pushFeatureEnabled: boolean;
  readonly emailProvider: string;
  readonly emailFromAddress: string;
  readonly emailFromName: string;
  readonly smsProvider: string;
  readonly smsSenderId: string;
  readonly pushProvider: string;
  readonly dispatchBatchSize: number;
  readonly dispatchRateLimitPerSec: number;
  readonly retryEnabled: boolean;
  readonly retryMaxAttempts: number;
  readonly retryBaseDelaySec: number;
  readonly autoSuppressOnPermanentFailure: boolean;
  readonly quotaCurrency: string;
  readonly quotaHardStopOnExceed: boolean;
  readonly smsDailyQuota: number;
  readonly smsMonthlyBudget: number;
  readonly smsCostPerSegment: number;
  readonly emailDailyQuota: number;
  readonly emailCostPerMessage: number;
  readonly pushDailyQuota: number;
  readonly pushCostPerMessage: number;
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
  readonly channelDeliveries?: readonly NotificationDeliveryItemView[];
  readonly deliverySummary?: NotificationBatchDeliverySummaryView;
}

export interface NotificationTemplateItemView {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly category: NotificationCategoryCode;
  readonly categoryName: NotificationCategoryName;
  readonly locale: string;
  readonly templateType: NotificationTemplateTypeName;
  readonly documentFormat: NotificationDocumentFormatName | null;
  readonly version: number;
  readonly publishedVersion: number;
  readonly latestDraftVersion: number | null;
  readonly status: NotificationTemplateVersionStatusName;
  readonly publishedAt: string | null;
  readonly publishedByUserId: number | null;
  readonly subjectTemplate: string | null;
  readonly bodyTemplate: string;
  readonly htmlTemplate: string | null;
  readonly variables: readonly string[];
  readonly usedByModules: readonly string[];
  readonly usageCount: number;
  readonly availableLocales?: readonly string[];
  readonly isActive: boolean;
  readonly isSystem: boolean;
  readonly organizationUnitId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NotificationTemplateVersionItemView {
  readonly id: number;
  readonly templateId: number;
  readonly code: string;
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly locale: string;
  readonly version: number;
  readonly status: NotificationTemplateVersionStatusName;
  readonly name: string;
  readonly templateType: NotificationTemplateTypeName;
  readonly documentFormat: NotificationDocumentFormatName | null;
  readonly subjectTemplate: string | null;
  readonly bodyTemplate: string;
  readonly htmlTemplate: string | null;
  readonly variables: readonly string[];
  readonly changeNote: string | null;
  readonly createdByUserId: number | null;
  readonly publishedAt: string | null;
  readonly publishedByUserId: number | null;
  readonly createdAt: string;
}

export interface NotificationTemplateUsageItemView {
  readonly id: number;
  readonly templateCode: string;
  readonly channel: NotificationChannelCode | null;
  readonly channelName: NotificationChannelName | 'ALL';
  readonly moduleName: string;
  readonly featureCode: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly createdByUserId: number | null;
  readonly createdAt: string;
}

export interface NotificationTemplatePreviewView {
  readonly code: string | null;
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly locale: string;
  readonly templateType?: NotificationTemplateTypeName;
  readonly documentFormat?: NotificationDocumentFormatName | null;
  readonly version?: number | null;
  readonly extractedVariables?: readonly string[];
  readonly renderedSubject: string | null;
  readonly renderedBody: string;
  readonly renderedHtml: string | null;
  readonly missingVariables: readonly string[];
  readonly smsSegmentsCount: number;
}

export interface RenderedDocumentFromTemplateView {
  readonly templateId: number | null;
  readonly templateCode: string;
  readonly locale: string;
  readonly versionUsed: number;
  readonly documentFormat: NotificationDocumentFormatName;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly renderedTitle: string;
  readonly renderedContent: string;
  readonly renderedHtml: string | null;
  readonly contentBase64: string;
  readonly missingVariables: readonly string[];
  readonly generatedAt: string;
}

export interface TemplateVersionMutationResultView {
  readonly template: NotificationTemplateItemView;
  readonly activeVersion: NotificationTemplateVersionItemView;
  readonly previousPublishedVersion: number | null;
  readonly action: 'PUBLISHED' | 'ROLLED_BACK';
  readonly auditRecorded: boolean;
}

export interface NotificationDeliveryItemView {
  readonly id: number;
  readonly notificationId: number;
  readonly recipientId: number | null;
  readonly recipientUserId: number;
  readonly organizationUnitId: number | null;
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly providerCode: string;
  readonly destination: string;
  readonly templateCode: string | null;
  readonly renderedSubject: string | null;
  readonly renderedBody: string;
  readonly idempotencyKey: string;
  readonly batchKey: string | null;
  readonly status: NotificationDeliveryStatusCode;
  readonly statusName: NotificationDeliveryStatusName;
  readonly statusLabel: string;
  readonly errorType: NotificationErrorTypeCode;
  readonly errorTypeName: NotificationErrorTypeName;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly nextRetryAt: string | null;
  readonly providerMessageId: string | null;
  readonly segmentsCount: number;
  readonly estimatedCost: number;
  readonly currency: string;
  readonly queuedAt: string;
  readonly sentAt: string | null;
  readonly deliveredAt: string | null;
  readonly failedAt: string | null;
}

export interface NotificationBatchDeliverySummaryView {
  readonly totalChannelDeliveries: number;
  readonly totalBatches: number;
  readonly batchSize: number;
  readonly queuedCount: number;
  readonly sentCount: number;
  readonly deliveredCount: number;
  readonly failedCount: number;
  readonly suppressedCount: number;
  readonly deduplicatedCount: number;
  readonly totalSmsSegments: number;
  readonly totalEstimatedCost: number;
  readonly currency: string;
}

export interface NotificationSuppressionItemView {
  readonly id: number;
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly destination: string;
  readonly reason: NotificationSuppressionReasonCode;
  readonly reasonName: NotificationSuppressionReasonName;
  readonly reasonLabel: string;
  readonly providerCode: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly sourceNotificationId: number | null;
  readonly isActive: boolean;
  readonly suppressedAt: string;
  readonly expiresAt: string | null;
}

export interface NotificationPushSubscriptionItemView {
  readonly id: number;
  readonly userId: number;
  readonly platform: NotificationPushPlatformCode;
  readonly platformName: NotificationPushPlatformName;
  readonly deviceToken: string;
  readonly endpoint: string | null;
  readonly deviceName: string | null;
  readonly isActive: boolean;
  readonly invalidatedAt: string | null;
  readonly failureReason: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export interface NotificationChannelQuotaItemView {
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly providerCode: string;
  readonly dailyPeriodKey: string;
  readonly monthlyPeriodKey: string;
  readonly dailySent: number;
  readonly dailyDelivered: number;
  readonly dailyFailed: number;
  readonly dailySuppressed: number;
  readonly dailySegments: number;
  readonly dailyCost: number;
  readonly dailyQuotaLimit: number;
  readonly dailyUsagePercent: number;
  readonly monthlySent: number;
  readonly monthlySegments: number;
  readonly monthlyCost: number;
  readonly monthlyBudgetLimit: number;
  readonly monthlyBudgetPercent: number;
  readonly isQuotaExceeded: boolean;
  readonly currency: string;
}

export interface NotificationQuotaAndCostSummaryView {
  readonly currency: string;
  readonly hardStopOnExceed: boolean;
  readonly totalDailyCost: number;
  readonly totalMonthlyCost: number;
  readonly totalDailySmsSegments: number;
  readonly totalMonthlySmsSegments: number;
  readonly channels: readonly NotificationChannelQuotaItemView[];
}
