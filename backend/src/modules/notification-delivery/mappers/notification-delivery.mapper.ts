import { Injectable } from '@nestjs/common';
import {
  getNotificationChannelName,
  getNotificationDeliveryStatusLabel,
  getNotificationDeliveryStatusName,
  getNotificationErrorTypeName,
  getNotificationPushPlatformName,
  getNotificationSuppressionReasonLabel,
  getNotificationSuppressionReasonName,
  parseNotificationChannel,
  parseNotificationDeliveryStatus,
  parseNotificationPushPlatform,
  parseNotificationSuppressionReason,
  type NotificationErrorTypeCode,
} from '../contracts/index.js';
import type { NotificationDeliveryEntity } from '../entities/notification-delivery.entity.js';
import type { NotificationPushSubscriptionEntity } from '../entities/notification-push-subscription.entity.js';
import type { NotificationSuppressionEntity } from '../entities/notification-suppression.entity.js';
import type {
  NotificationDeliveryItemView,
  NotificationPushSubscriptionItemView,
  NotificationSuppressionItemView,
} from '../types/notification-delivery.types.js';

@Injectable()
export class NotificationDeliveryMapper {
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
