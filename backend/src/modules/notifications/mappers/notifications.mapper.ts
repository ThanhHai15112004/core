import { Injectable } from '@nestjs/common';
import { safeJsonParseObject, safeJsonParseStringArray } from '@packages/kernel/index.js';
import {
  getNotificationCategoryLabel,
  getNotificationCategoryName,
  getNotificationChannelName,
  getNotificationDeliveryStatusLabel,
  getNotificationDeliveryStatusName,
  getNotificationErrorTypeName,
  getNotificationInboxStatusName,
  getNotificationPriorityLabel,
  getNotificationPriorityName,
  getNotificationPushPlatformName,
  getNotificationSuppressionReasonLabel,
  getNotificationSuppressionReasonName,
  getNotificationTargetTypeLabel,
  getNotificationTargetTypeName,
  parseNotificationCategory,
  parseNotificationChannel,
  parseNotificationDeliveryStatus,
  parseNotificationInboxStatus,
  parseNotificationPriority,
  parseNotificationPushPlatform,
  parseNotificationSuppressionReason,
  parseNotificationTargetType,
} from '../contracts/index.js';
import type { NotificationDeliveryEntity } from '../entities/notification-delivery.entity.js';
import type { NotificationPushSubscriptionEntity } from '../entities/notification-push-subscription.entity.js';
import type { NotificationRecipientEntity } from '../entities/notification-recipient.entity.js';
import type { NotificationSuppressionEntity } from '../entities/notification-suppression.entity.js';
import type { NotificationTemplateEntity } from '../entities/notification-template.entity.js';
import type { NotificationEntity } from '../entities/notification.entity.js';
import type {
  NotificationChannelName,
  NotificationErrorTypeCode,
} from '../enum/notifications.enum.js';
import { extractTemplateVariables } from '../helpers/notification-template.helper.js';
import type { NotificationDispatchAggregateStats } from '../repositories/notification-recipients.repository.js';
import type {
  NotificationBatchDeliverySummaryView,
  NotificationDeliveryItemView,
  NotificationDispatchDetailView,
  NotificationDispatchHistoryItemView,
  NotificationDispatchRecipientDetailView,
  NotificationInboxItemView,
  NotificationPushSubscriptionItemView,
  NotificationSuppressionItemView,
  NotificationTargetPayload,
  NotificationTemplateItemView,
} from '../types/notifications.types.js';

@Injectable()
export class NotificationsMapper {
  public toInboxItemView(
    recipient: NotificationRecipientEntity,
    notification: NotificationEntity,
    locale = 'vi',
  ): NotificationInboxItemView {
    const category = parseNotificationCategory(notification.category);
    const priority = parseNotificationPriority(notification.priority);
    const targetType = parseNotificationTargetType(notification.targetType);
    const channel = parseNotificationChannel(recipient.channel);
    const inboxStatus = parseNotificationInboxStatus(recipient.inboxStatus);
    const metadata = notification.metadataJson
      ? safeJsonParseObject<Record<string, unknown>>(notification.metadataJson)
      : null;

    return {
      id: Number(recipient.id),
      notificationId: Number(notification.id),
      code: notification.code,
      title: notification.title,
      content: notification.content,
      category,
      categoryName: getNotificationCategoryName(category),
      categoryLabel: getNotificationCategoryLabel(category, locale),
      priority,
      priorityName: getNotificationPriorityName(priority),
      priorityLabel: getNotificationPriorityLabel(priority, locale),
      targetType,
      targetTypeName: getNotificationTargetTypeName(targetType),
      channel,
      channelName: getNotificationChannelName(channel),
      isRead: Boolean(recipient.isRead),
      readAt: recipient.readAt ? recipient.readAt.toISOString() : null,
      inboxStatus,
      inboxStatusName: getNotificationInboxStatusName(inboxStatus),
      archivedAt: recipient.archivedAt ? recipient.archivedAt.toISOString() : null,
      actionUrl: notification.actionUrl ?? null,
      referenceModule: notification.referenceModule ?? null,
      referenceType: notification.referenceType ?? null,
      referenceId: notification.referenceId ?? null,
      metadata: metadata && Object.keys(metadata).length > 0 ? metadata : null,
      senderUserId:
        notification.senderUserId !== undefined && notification.senderUserId !== null
          ? Number(notification.senderUserId)
          : null,
      organizationUnitId:
        notification.organizationUnitId !== undefined && notification.organizationUnitId !== null
          ? Number(notification.organizationUnitId)
          : null,
      deliveredAt: (recipient.deliveredAt ?? recipient.createdAt ?? new Date()).toISOString(),
      dispatchedAt: (
        notification.dispatchedAt ??
        notification.createdAt ??
        new Date()
      ).toISOString(),
    };
  }

  public toDispatchHistoryItemView(
    notification: NotificationEntity,
    stats?: NotificationDispatchAggregateStats,
    locale = 'vi',
  ): NotificationDispatchHistoryItemView {
    const category = parseNotificationCategory(notification.category);
    const priority = parseNotificationPriority(notification.priority);
    const targetType = parseNotificationTargetType(notification.targetType);
    const targetPayload = safeJsonParseObject<Record<string, unknown>>(
      notification.targetIdsJson,
    ) as unknown as NotificationTargetPayload;
    const rawChannels = safeJsonParseStringArray(notification.channelsJson);
    const channels = (
      rawChannels.length > 0 ? rawChannels : ['IN_APP']
    ) as NotificationChannelName[];
    const metadata = notification.metadataJson
      ? safeJsonParseObject<Record<string, unknown>>(notification.metadataJson)
      : null;

    return {
      id: Number(notification.id),
      code: notification.code,
      title: notification.title,
      content: notification.content,
      category,
      categoryName: getNotificationCategoryName(category),
      categoryLabel: getNotificationCategoryLabel(category, locale),
      priority,
      priorityName: getNotificationPriorityName(priority),
      priorityLabel: getNotificationPriorityLabel(priority, locale),
      targetType,
      targetTypeName: getNotificationTargetTypeName(targetType),
      targetTypeLabel: getNotificationTargetTypeLabel(targetType, locale),
      targetPayload,
      channels,
      actionUrl: notification.actionUrl ?? null,
      referenceModule: notification.referenceModule ?? null,
      referenceType: notification.referenceType ?? null,
      referenceId: notification.referenceId ?? null,
      metadata: metadata && Object.keys(metadata).length > 0 ? metadata : null,
      senderUserId:
        notification.senderUserId !== undefined && notification.senderUserId !== null
          ? Number(notification.senderUserId)
          : null,
      organizationUnitId:
        notification.organizationUnitId !== undefined && notification.organizationUnitId !== null
          ? Number(notification.organizationUnitId)
          : null,
      totalTargeted: Number(notification.totalTargeted ?? 0),
      totalDelivered: Number(notification.totalDelivered ?? 0),
      totalSkippedByPref: Number(notification.totalSkippedByPref ?? 0),
      readCount: stats?.readCount ?? 0,
      archivedCount: stats?.archivedCount ?? 0,
      deletedFromInboxCount: stats?.deletedFromInboxCount ?? 0,
      dispatchedAt: (
        notification.dispatchedAt ??
        notification.createdAt ??
        new Date()
      ).toISOString(),
      createdAt: (notification.createdAt ?? new Date()).toISOString(),
    };
  }

  public toDispatchRecipientDetailView(
    recipient: NotificationRecipientEntity,
  ): NotificationDispatchRecipientDetailView {
    const channel = parseNotificationChannel(recipient.channel);
    const inboxStatus = parseNotificationInboxStatus(recipient.inboxStatus);

    return {
      recipientEntryId: Number(recipient.id),
      recipientUserId: Number(recipient.recipientUserId),
      channel,
      channelName: getNotificationChannelName(channel),
      isRead: Boolean(recipient.isRead),
      readAt: recipient.readAt ? recipient.readAt.toISOString() : null,
      inboxStatus,
      inboxStatusName: getNotificationInboxStatusName(inboxStatus),
      archivedAt: recipient.archivedAt ? recipient.archivedAt.toISOString() : null,
      recipientDeletedAt: recipient.recipientDeletedAt
        ? recipient.recipientDeletedAt.toISOString()
        : null,
      deliveredAt: (recipient.deliveredAt ?? recipient.createdAt ?? new Date()).toISOString(),
    };
  }

  public toDispatchDetailView(
    notification: NotificationEntity,
    recipients: readonly NotificationRecipientEntity[],
    stats?: NotificationDispatchAggregateStats,
    locale = 'vi',
    channelDeliveries?: readonly NotificationDeliveryItemView[],
    deliverySummary?: NotificationBatchDeliverySummaryView,
  ): NotificationDispatchDetailView {
    const base = this.toDispatchHistoryItemView(notification, stats, locale);
    return {
      ...base,
      recipients: recipients.map((r) => this.toDispatchRecipientDetailView(r)),
      ...(channelDeliveries ? { channelDeliveries } : {}),
      ...(deliverySummary ? { deliverySummary } : {}),
    };
  }

  public toTemplateItemView(entity: NotificationTemplateEntity): NotificationTemplateItemView {
    const channel = parseNotificationChannel(entity.channel);
    const category = parseNotificationCategory(entity.category);
    const declaredVars = entity.variablesJson ? safeJsonParseStringArray(entity.variablesJson) : [];
    const extractedVars = [
      ...new Set([
        ...declaredVars,
        ...extractTemplateVariables(entity.subjectTemplate),
        ...extractTemplateVariables(entity.bodyTemplate),
        ...extractTemplateVariables(entity.htmlTemplate),
      ]),
    ];

    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      channel,
      channelName: getNotificationChannelName(channel),
      category,
      categoryName: getNotificationCategoryName(category),
      locale: entity.locale || 'vi',
      subjectTemplate: entity.subjectTemplate ?? null,
      bodyTemplate: entity.bodyTemplate,
      htmlTemplate: entity.htmlTemplate ?? null,
      variables: extractedVars,
      isActive: Boolean(entity.isActive),
      isSystem: Boolean(entity.isSystem),
      organizationUnitId:
        entity.organizationUnitId !== undefined && entity.organizationUnitId !== null
          ? Number(entity.organizationUnitId)
          : null,
      createdAt: (entity.createdAt ?? new Date()).toISOString(),
      updatedAt: (entity.updatedAt ?? entity.createdAt ?? new Date()).toISOString(),
    };
  }

  public toDeliveryItemView(
    entity: NotificationDeliveryEntity,
    locale = 'vi',
  ): NotificationDeliveryItemView {
    const channel = parseNotificationChannel(entity.channel);
    const status = parseNotificationDeliveryStatus(entity.status);
    const errorType = Number(entity.errorType ?? 0) as NotificationErrorTypeCode;

    return {
      id: Number(entity.id),
      notificationId: Number(entity.notificationId),
      recipientId:
        entity.recipientId !== undefined && entity.recipientId !== null
          ? Number(entity.recipientId)
          : null,
      recipientUserId: Number(entity.recipientUserId),
      organizationUnitId:
        entity.organizationUnitId !== undefined && entity.organizationUnitId !== null
          ? Number(entity.organizationUnitId)
          : null,
      channel,
      channelName: getNotificationChannelName(channel),
      providerCode: entity.providerCode,
      destination: entity.destination,
      templateCode: entity.templateCode ?? null,
      renderedSubject: entity.renderedSubject ?? null,
      renderedBody: entity.renderedBody,
      idempotencyKey: entity.idempotencyKey,
      batchKey: entity.batchKey ?? null,
      status,
      statusName: getNotificationDeliveryStatusName(status),
      statusLabel: getNotificationDeliveryStatusLabel(status, locale),
      errorType,
      errorTypeName: getNotificationErrorTypeName(errorType),
      errorCode: entity.errorCode ?? null,
      errorMessage: entity.errorMessage ?? null,
      attemptCount: Number(entity.attemptCount ?? 0),
      maxAttempts: Number(entity.maxAttempts ?? 3),
      nextRetryAt: entity.nextRetryAt ? entity.nextRetryAt.toISOString() : null,
      providerMessageId: entity.providerMessageId ?? null,
      segmentsCount: Number(entity.segmentsCount ?? 1),
      estimatedCost: Number(Number(entity.estimatedCost ?? 0).toFixed(4)),
      currency: entity.currency || 'VND',
      queuedAt: (entity.queuedAt ?? entity.createdAt ?? new Date()).toISOString(),
      sentAt: entity.sentAt ? entity.sentAt.toISOString() : null,
      deliveredAt: entity.deliveredAt ? entity.deliveredAt.toISOString() : null,
      failedAt: entity.failedAt ? entity.failedAt.toISOString() : null,
    };
  }

  public toSuppressionItemView(
    entity: NotificationSuppressionEntity,
    locale = 'vi',
  ): NotificationSuppressionItemView {
    const channel = parseNotificationChannel(entity.channel);
    const reason = parseNotificationSuppressionReason(entity.reason);

    return {
      id: Number(entity.id),
      channel,
      channelName: getNotificationChannelName(channel),
      destination: entity.destination,
      reason,
      reasonName: getNotificationSuppressionReasonName(reason),
      reasonLabel: getNotificationSuppressionReasonLabel(reason, locale),
      providerCode: entity.providerCode ?? null,
      errorCode: entity.errorCode ?? null,
      errorMessage: entity.errorMessage ?? null,
      sourceNotificationId:
        entity.sourceNotificationId !== undefined && entity.sourceNotificationId !== null
          ? Number(entity.sourceNotificationId)
          : null,
      isActive: Boolean(entity.isActive),
      suppressedAt: (entity.suppressedAt ?? entity.createdAt ?? new Date()).toISOString(),
      expiresAt: entity.expiresAt ? entity.expiresAt.toISOString() : null,
    };
  }

  public toPushSubscriptionItemView(
    entity: NotificationPushSubscriptionEntity,
  ): NotificationPushSubscriptionItemView {
    const platform = parseNotificationPushPlatform(entity.platform);
    return {
      id: Number(entity.id),
      userId: Number(entity.userId),
      platform,
      platformName: getNotificationPushPlatformName(platform),
      deviceToken: entity.deviceToken,
      endpoint: entity.endpoint ?? null,
      deviceName: entity.deviceName ?? null,
      isActive: Boolean(entity.isActive),
      invalidatedAt: entity.invalidatedAt ? entity.invalidatedAt.toISOString() : null,
      failureReason: entity.failureReason ?? null,
      lastUsedAt: entity.lastUsedAt ? entity.lastUsedAt.toISOString() : null,
      createdAt: (entity.createdAt ?? new Date()).toISOString(),
    };
  }
}
