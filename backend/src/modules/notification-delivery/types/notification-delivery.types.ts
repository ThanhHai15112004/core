import type {
  NotificationChannelCode,
  NotificationChannelName,
  NotificationDeliveryStatusCode,
  NotificationDeliveryStatusName,
  NotificationErrorTypeCode,
  NotificationErrorTypeName,
  NotificationPushPlatformCode,
  NotificationPushPlatformName,
  NotificationSuppressionReasonCode,
  NotificationSuppressionReasonName,
} from '../enum/notification-delivery.enum.js';

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

export interface DispatchExternalChannelNotificationInput {
  readonly id: number;
  readonly code: string;
  readonly title: string;
  readonly content: string;
  readonly organizationUnitId?: number | null;
}

export interface DispatchExternalChannelRecipientEntryInput {
  readonly id?: number;
  readonly recipientUserId: number;
  readonly channel: number;
}
