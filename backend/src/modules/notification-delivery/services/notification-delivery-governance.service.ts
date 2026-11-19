import { Injectable, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  NotFoundAppException,
  type PaginatedResult,
  resolvePagination,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_AUDIT_META,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_ERROR_TYPE,
  NOTIFICATION_PUSH_PLATFORM,
  NOTIFICATION_SUPPRESSION_REASON,
  getNotificationChannelName,
  parseNotificationChannel,
  parseNotificationDeliveryStatus,
  parseNotificationPushPlatform,
  parseNotificationSuppressionReason,
  type NotificationChannelCode,
} from '../contracts/index.js';
import { resolveNotificationRuntimeConfig } from '../helpers/notification-delivery-config.helper.js';
import { resolveCurrentQuotaPeriodKeys } from '../helpers/notification-delivery-policy.helper.js';
import { NotificationDeliveryMapper } from '../mappers/notification-delivery.mapper.js';
import { NotificationDeliveryRepository } from '../repositories/notification-delivery.repository.js';
import type {
  CreateNotificationSuppressionRequest,
  ListNotificationDeliveriesQuery,
  ListNotificationSuppressionsQuery,
  RegisterPushSubscriptionRequest,
  UpdateDeliveryStatusWebhookRequest,
} from '../requests/notification-delivery.requests.js';
import type {
  NotificationDeliveryItemResponse,
  NotificationPushSubscriptionItemResponse,
  NotificationQuotaAndCostSummaryResponse,
  NotificationSuppressionItemResponse,
} from '../responses/notification-delivery.response.js';
import type {
  NotificationChannelQuotaItemView,
  NotificationDeliveryItemView,
  ResolvedNotificationRuntimeConfig,
} from '../types/notification-delivery.types.js';

@Injectable()
export class NotificationDeliveryGovernanceService {
  constructor(
    private readonly channelsRepo: NotificationDeliveryRepository,
    private readonly mapper: NotificationDeliveryMapper = new NotificationDeliveryMapper(),
    @Optional() private readonly auditLogService?: AuditLogService | null,
  ) {}

  public async updateDeliveryStatusWebhook(
    deliveryId: number,
    input: UpdateDeliveryStatusWebhookRequest,
    actor?: UserIdentity,
    locale = 'vi',
  ): Promise<NotificationDeliveryItemResponse> {
    const delivery = await this.channelsRepo.findDeliveryById(deliveryId);
    if (!delivery) {
      throw new NotFoundAppException('notifications.deliveryNotFound', { id: deliveryId });
    }

    const previousStatus = parseNotificationDeliveryStatus(delivery.status);
    const targetStatus = parseNotificationDeliveryStatus(input.status);
    const now = new Date();
    const periodKeys = resolveCurrentQuotaPeriodKeys(now);
    const runtimeConfig = resolveNotificationRuntimeConfig(delivery.organizationUnitId ?? null);

    delivery.status = targetStatus;
    if (input.providerMessageId !== undefined && input.providerMessageId !== null) {
      delivery.providerMessageId = input.providerMessageId;
    }

    if (targetStatus === NOTIFICATION_DELIVERY_STATUS.DELIVERED) {
      delivery.deliveredAt = now;
      delivery.errorType = NOTIFICATION_ERROR_TYPE.NONE;
      delivery.errorCode = null;
      delivery.errorMessage = null;
      delivery.nextRetryAt = null;
      if (previousStatus !== NOTIFICATION_DELIVERY_STATUS.DELIVERED) {
        await this.channelsRepo.recordQuotaDelta({
          channel: Number(delivery.channel),
          providerCode: delivery.providerCode,
          dailyPeriodKey: periodKeys.dailyPeriodKey,
          monthlyPeriodKey: periodKeys.monthlyPeriodKey,
          currency: delivery.currency,
          deliveredDelta: 1,
        });
      }
    } else if (targetStatus === NOTIFICATION_DELIVERY_STATUS.FAILED) {
      delivery.failedAt = now;
      delivery.nextRetryAt = null;
      delivery.errorCode = input.errorCode ?? delivery.errorCode ?? 'WEBHOOK_DELIVERY_FAILED';
      delivery.errorMessage =
        input.errorMessage ?? delivery.errorMessage ?? 'Delivery failed reported by webhook';
      delivery.errorType = input.isPermanentFailure
        ? NOTIFICATION_ERROR_TYPE.PERMANENT
        : NOTIFICATION_ERROR_TYPE.TRANSIENT;

      await this.channelsRepo.recordQuotaDelta({
        channel: Number(delivery.channel),
        providerCode: delivery.providerCode,
        dailyPeriodKey: periodKeys.dailyPeriodKey,
        monthlyPeriodKey: periodKeys.monthlyPeriodKey,
        currency: delivery.currency,
        failedDelta: 1,
      });

      if (input.isPermanentFailure && runtimeConfig.autoSuppressOnPermanentFailure) {
        const reason =
          input.suppressionReason !== undefined
            ? parseNotificationSuppressionReason(input.suppressionReason)
            : Number(delivery.channel) === NOTIFICATION_CHANNEL.PUSH
              ? NOTIFICATION_SUPPRESSION_REASON.UNREGISTERED_TOKEN
              : NOTIFICATION_SUPPRESSION_REASON.HARD_BOUNCE;

        await this.channelsRepo.upsertSuppression({
          channel: Number(delivery.channel),
          destination: delivery.destination,
          reason,
          providerCode: delivery.providerCode,
          errorCode: delivery.errorCode,
          errorMessage: delivery.errorMessage,
          sourceNotificationId: Number(delivery.notificationId),
        });

        if (Number(delivery.channel) === NOTIFICATION_CHANNEL.PUSH) {
          await this.channelsRepo.deactivatePushToken(
            delivery.destination,
            delivery.errorMessage ?? 'Push token invalidated via webhook',
          );
        }
      }
    }

    const saved = await this.channelsRepo.saveEntity(delivery);
    await this.recordAudit(
      actor,
      'UPDATE_NOTIFICATION_DELIVERY_STATUS',
      NOTIFICATION_DELIVERY_AUDIT_META.ENTITY_DELIVERY,
      String(deliveryId),
      { status: previousStatus },
      { status: targetStatus },
    );

    return this.mapper.toDeliveryItemView(saved, locale);
  }

  public async listDeliveries(
    query: ListNotificationDeliveriesQuery,
    locale = 'vi',
  ): Promise<PaginatedResult<NotificationDeliveryItemResponse>> {
    const pagination = resolvePagination(query, {
      settingPrefix: 'notifications.pagination',
    });
    const paginated = await this.channelsRepo.findPaginatedDeliveries({
      ...pagination,
      notificationId: query.notificationId,
      recipientUserId: query.recipientUserId,
      channel: query.channel,
      status: query.status,
      providerCode: query.providerCode,
      batchKey: query.batchKey,
      search: query.search,
    });

    const items = paginated.items.map((d) => this.mapper.toDeliveryItemView(d, locale));
    return createPaginatedResult(items, paginated.total, paginated.page, paginated.limit);
  }

  public async listDeliveriesForNotification(
    notificationId: number,
    locale = 'vi',
  ): Promise<NotificationDeliveryItemView[]> {
    const list = await this.channelsRepo.findDeliveriesByNotificationId(notificationId);
    return list.map((d) => this.mapper.toDeliveryItemView(d, locale));
  }

  public async listSuppressions(
    query: ListNotificationSuppressionsQuery,
    locale = 'vi',
  ): Promise<PaginatedResult<NotificationSuppressionItemResponse>> {
    const pagination = resolvePagination(query, {
      settingPrefix: 'notifications.pagination',
    });
    const paginated = await this.channelsRepo.findPaginatedSuppressions({
      ...pagination,
      channel: query.channel,
      reason: query.reason,
      isActive: query.isActive,
      search: query.search,
    });

    const items = paginated.items.map((s) => this.mapper.toSuppressionItemView(s, locale));
    return createPaginatedResult(items, paginated.total, paginated.page, paginated.limit);
  }

  public async addSuppression(
    input: CreateNotificationSuppressionRequest,
    actor?: UserIdentity,
    locale = 'vi',
  ): Promise<NotificationSuppressionItemResponse> {
    const channel = parseNotificationChannel(input.channel);
    const reason =
      input.reason !== undefined
        ? parseNotificationSuppressionReason(input.reason)
        : NOTIFICATION_SUPPRESSION_REASON.MANUAL_BLOCK;

    const saved = await this.channelsRepo.upsertSuppression({
      channel,
      destination: input.destination.trim(),
      reason,
      providerCode: 'MANUAL',
      errorCode: 'MANUAL_SUPPRESSION',
      errorMessage: input.errorMessage ?? 'Manually suppressed by administrator',
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    });

    if (channel === NOTIFICATION_CHANNEL.PUSH) {
      await this.channelsRepo.deactivatePushToken(
        input.destination.trim(),
        input.errorMessage ?? 'Manually suppressed',
      );
    }

    await this.recordAudit(
      actor,
      'ADD_NOTIFICATION_SUPPRESSION',
      NOTIFICATION_DELIVERY_AUDIT_META.ENTITY_SUPPRESSION,
      String(saved.id),
      null,
      { channel, destination: saved.destination, reason },
    );

    return this.mapper.toSuppressionItemView(saved, locale);
  }

  public async removeSuppression(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ removed: boolean; id: number }> {
    const removed = await this.channelsRepo.removeSuppressionById(id);
    if (!removed) {
      throw new NotFoundAppException('notifications.suppressionNotFound', { id });
    }
    await this.recordAudit(
      actor,
      'REMOVE_NOTIFICATION_SUPPRESSION',
      NOTIFICATION_DELIVERY_AUDIT_META.ENTITY_SUPPRESSION,
      String(id),
      null,
      { isActive: false },
    );
    return { removed: true, id };
  }

  public async listUserPushSubscriptions(
    userId: number,
  ): Promise<NotificationPushSubscriptionItemResponse[]> {
    const list = await this.channelsRepo.findUserPushSubscriptions(userId);
    return list.map((s) => this.mapper.toPushSubscriptionItemView(s));
  }

  public async registerPushSubscription(
    userId: number,
    input: RegisterPushSubscriptionRequest,
    actor?: UserIdentity,
  ): Promise<NotificationPushSubscriptionItemResponse> {
    const platform =
      input.platform !== undefined
        ? parseNotificationPushPlatform(input.platform)
        : NOTIFICATION_PUSH_PLATFORM.WEB_PUSH;

    const saved = await this.channelsRepo.upsertPushSubscription({
      userId,
      platform,
      deviceToken: input.deviceToken,
      endpoint: input.endpoint ?? null,
      p256dhKey: input.p256dhKey ?? null,
      authKey: input.authKey ?? null,
      deviceName: input.deviceName ?? null,
    });

    await this.recordAudit(
      actor,
      'REGISTER_PUSH_SUBSCRIPTION',
      NOTIFICATION_DELIVERY_AUDIT_META.ENTITY_PUSH_SUBSCRIPTION,
      String(saved.id),
      null,
      { userId, platform, deviceName: saved.deviceName },
    );

    return this.mapper.toPushSubscriptionItemView(saved);
  }

  public async unregisterPushSubscription(
    userId: number,
    subscriptionId: number,
    actor?: UserIdentity,
  ): Promise<{ removed: true; id: number }> {
    const removed = await this.channelsRepo.removeUserPushSubscription(subscriptionId, userId);
    if (!removed) {
      throw new NotFoundAppException('notifications.pushSubscriptionNotFound', {
        id: subscriptionId,
      });
    }
    await this.recordAudit(
      actor,
      'UNREGISTER_PUSH_SUBSCRIPTION',
      NOTIFICATION_DELIVERY_AUDIT_META.ENTITY_PUSH_SUBSCRIPTION,
      String(subscriptionId),
      { userId },
      null,
    );
    return { removed: true, id: subscriptionId };
  }

  public async getQuotaAndCostSummary(
    organizationUnitId?: number | null,
    now: Date = new Date(),
  ): Promise<NotificationQuotaAndCostSummaryResponse> {
    const runtimeConfig = resolveNotificationRuntimeConfig(organizationUnitId);
    const periodKeys = resolveCurrentQuotaPeriodKeys(now);

    const channelConfigs: Array<{
      channel: NotificationChannelCode;
      providerCode: string;
      dailyQuotaLimit: number;
      monthlyBudgetLimit: number;
    }> = [
      {
        channel: NOTIFICATION_CHANNEL.SMS,
        providerCode: runtimeConfig.smsProvider,
        dailyQuotaLimit: runtimeConfig.smsDailyQuota,
        monthlyBudgetLimit: runtimeConfig.smsMonthlyBudget,
      },
      {
        channel: NOTIFICATION_CHANNEL.EMAIL,
        providerCode: runtimeConfig.emailProvider,
        dailyQuotaLimit: runtimeConfig.emailDailyQuota,
        monthlyBudgetLimit: 0,
      },
      {
        channel: NOTIFICATION_CHANNEL.PUSH,
        providerCode: runtimeConfig.pushProvider,
        dailyQuotaLimit: runtimeConfig.pushDailyQuota,
        monthlyBudgetLimit: 0,
      },
    ];

    const items: NotificationChannelQuotaItemView[] = [];
    let totalDailyCost = 0;
    let totalMonthlyCost = 0;
    let totalDailySmsSegments = 0;
    let totalMonthlySmsSegments = 0;

    for (const cfg of channelConfigs) {
      const daily = await this.channelsRepo.getOrCreateQuotaUsage({
        channel: cfg.channel,
        providerCode: cfg.providerCode,
        periodType: 'DAILY',
        periodKey: periodKeys.dailyPeriodKey,
        currency: runtimeConfig.quotaCurrency,
      });
      const monthly = await this.channelsRepo.getOrCreateQuotaUsage({
        channel: cfg.channel,
        providerCode: cfg.providerCode,
        periodType: 'MONTHLY',
        periodKey: periodKeys.monthlyPeriodKey,
        currency: runtimeConfig.quotaCurrency,
      });

      const dailySent = Number(daily.totalSent ?? 0);
      const dailySegments = Number(daily.totalSegments ?? 0);
      const dailyCost = Number(Number(daily.totalCost ?? 0).toFixed(4));
      const monthlySent = Number(monthly.totalSent ?? 0);
      const monthlySegments = Number(monthly.totalSegments ?? 0);
      const monthlyCost = Number(Number(monthly.totalCost ?? 0).toFixed(4));

      const dailyMetric = cfg.channel === NOTIFICATION_CHANNEL.SMS ? dailySegments : dailySent;
      const dailyUsagePercent =
        cfg.dailyQuotaLimit > 0
          ? Number(((dailyMetric / cfg.dailyQuotaLimit) * 100).toFixed(2))
          : 0;
      const monthlyBudgetPercent =
        cfg.monthlyBudgetLimit > 0
          ? Number(((monthlyCost / cfg.monthlyBudgetLimit) * 100).toFixed(2))
          : 0;

      const isQuotaExceeded =
        (cfg.dailyQuotaLimit > 0 && dailyMetric >= cfg.dailyQuotaLimit) ||
        (cfg.monthlyBudgetLimit > 0 && monthlyCost >= cfg.monthlyBudgetLimit);

      totalDailyCost = Number((totalDailyCost + dailyCost).toFixed(4));
      totalMonthlyCost = Number((totalMonthlyCost + monthlyCost).toFixed(4));
      if (cfg.channel === NOTIFICATION_CHANNEL.SMS) {
        totalDailySmsSegments += dailySegments;
        totalMonthlySmsSegments += monthlySegments;
      }

      items.push({
        channel: cfg.channel,
        channelName: getNotificationChannelName(cfg.channel),
        providerCode: cfg.providerCode,
        dailyPeriodKey: periodKeys.dailyPeriodKey,
        monthlyPeriodKey: periodKeys.monthlyPeriodKey,
        dailySent,
        dailyDelivered: Number(daily.totalDelivered ?? 0),
        dailyFailed: Number(daily.totalFailed ?? 0),
        dailySuppressed: Number(daily.totalSuppressed ?? 0),
        dailySegments,
        dailyCost,
        dailyQuotaLimit: cfg.dailyQuotaLimit,
        dailyUsagePercent,
        monthlySent,
        monthlySegments,
        monthlyCost,
        monthlyBudgetLimit: cfg.monthlyBudgetLimit,
        monthlyBudgetPercent,
        isQuotaExceeded,
        currency: runtimeConfig.quotaCurrency,
      });
    }

    return {
      currency: runtimeConfig.quotaCurrency,
      hardStopOnExceed: runtimeConfig.quotaHardStopOnExceed,
      totalDailyCost,
      totalMonthlyCost,
      totalDailySmsSegments,
      totalMonthlySmsSegments,
      channels: items,
    };
  }

  public async checkQuotaAvailability(params: {
    channel: NotificationChannelCode;
    providerCode: string;
    segmentsToConsume: number;
    costToConsume: number;
    runtimeConfig: ResolvedNotificationRuntimeConfig;
    now: Date;
  }): Promise<{
    readonly allowed: boolean;
    readonly errorCode?: string;
    readonly errorMessage?: string;
  }> {
    const { channel, providerCode, segmentsToConsume, costToConsume, runtimeConfig, now } = params;
    const periodKeys = resolveCurrentQuotaPeriodKeys(now);

    const daily = await this.channelsRepo.getOrCreateQuotaUsage({
      channel,
      providerCode,
      periodType: 'DAILY',
      periodKey: periodKeys.dailyPeriodKey,
      currency: runtimeConfig.quotaCurrency,
    });
    const monthly = await this.channelsRepo.getOrCreateQuotaUsage({
      channel,
      providerCode,
      periodType: 'MONTHLY',
      periodKey: periodKeys.monthlyPeriodKey,
      currency: runtimeConfig.quotaCurrency,
    });

    if (channel === NOTIFICATION_CHANNEL.SMS) {
      if (
        runtimeConfig.smsDailyQuota > 0 &&
        Number(daily.totalSegments) + segmentsToConsume > runtimeConfig.smsDailyQuota
      ) {
        return {
          allowed: false,
          errorCode: 'SMS_DAILY_QUOTA_EXCEEDED',
          errorMessage: `SMS daily segment quota exceeded (${daily.totalSegments} + ${segmentsToConsume} > ${runtimeConfig.smsDailyQuota})`,
        };
      }
      if (
        runtimeConfig.smsMonthlyBudget > 0 &&
        Number(monthly.totalCost) + costToConsume > runtimeConfig.smsMonthlyBudget
      ) {
        return {
          allowed: false,
          errorCode: 'SMS_MONTHLY_BUDGET_EXCEEDED',
          errorMessage: `SMS monthly budget exceeded (${monthly.totalCost} + ${costToConsume} > ${runtimeConfig.smsMonthlyBudget} ${runtimeConfig.quotaCurrency})`,
        };
      }
    } else if (channel === NOTIFICATION_CHANNEL.EMAIL) {
      if (
        runtimeConfig.emailDailyQuota > 0 &&
        Number(daily.totalSent) + 1 > runtimeConfig.emailDailyQuota
      ) {
        return {
          allowed: false,
          errorCode: 'EMAIL_DAILY_QUOTA_EXCEEDED',
          errorMessage: `Email daily quota exceeded (${daily.totalSent} + 1 > ${runtimeConfig.emailDailyQuota})`,
        };
      }
    } else if (channel === NOTIFICATION_CHANNEL.PUSH) {
      if (
        runtimeConfig.pushDailyQuota > 0 &&
        Number(daily.totalSent) + 1 > runtimeConfig.pushDailyQuota
      ) {
        return {
          allowed: false,
          errorCode: 'PUSH_DAILY_QUOTA_EXCEEDED',
          errorMessage: `Push daily quota exceeded (${daily.totalSent} + 1 > ${runtimeConfig.pushDailyQuota})`,
        };
      }
    }

    return { allowed: true };
  }

  public async recordAudit(
    actor: UserIdentity | undefined,
    action: string,
    resourceType: string,
    resourceId: string,
    beforeData: Record<string, unknown> | null,
    afterData: Record<string, unknown> | null,
  ): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService
      .record({
        actor: actor ?? null,
        actorUserId: actor?.id ?? null,
        actorIdentifier: actor?.email ?? actor?.username ?? 'system',
        module: NOTIFICATION_DELIVERY_AUDIT_META.MODULE,
        feature: 'multi_channel_notifications',
        action,
        resourceType,
        resourceId,
        beforeData,
        afterData,
      })
      .catch(() => undefined);
  }
}
