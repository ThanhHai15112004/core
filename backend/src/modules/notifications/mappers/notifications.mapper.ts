import { Injectable } from '@nestjs/common';
import { safeJsonParseObject, safeJsonParseStringArray } from '@packages/kernel/index.js';
import {
  getNotificationCategoryLabel,
  getNotificationCategoryName,
  getNotificationChannelName,
  getNotificationInboxStatusName,
  getNotificationPriorityLabel,
  getNotificationPriorityName,
  getNotificationTargetTypeLabel,
  getNotificationTargetTypeName,
  parseNotificationCategory,
  parseNotificationChannel,
  parseNotificationInboxStatus,
  parseNotificationPriority,
  parseNotificationTargetType,
} from '../contracts/index.js';
import type { NotificationRecipientEntity } from '../entities/notification-recipient.entity.js';
import type { NotificationEntity } from '../entities/notification.entity.js';
import type { NotificationChannelName } from '../enum/notifications.enum.js';
import type { NotificationDispatchAggregateStats } from '../repositories/notification-recipients.repository.js';
import type {
  NotificationDispatchDetailView,
  NotificationDispatchHistoryItemView,
  NotificationDispatchRecipientDetailView,
  NotificationInboxItemView,
  NotificationTargetPayload,
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
  ): NotificationDispatchDetailView {
    const base = this.toDispatchHistoryItemView(notification, stats, locale);
    return {
      ...base,
      recipients: recipients.map((r) => this.toDispatchRecipientDetailView(r)),
    };
  }
}
