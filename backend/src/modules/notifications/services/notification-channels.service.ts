import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
  type PaginatedResult,
  resolvePagination,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  type UserNotificationContactView,
} from '@modules/users/contracts/index.js';
import { NotificationChannelAdapterRegistry } from '../adapters/notification-channel.adapters.js';
import {
  NOTIFICATIONS_AUDIT_META,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_ERROR_TYPE,
  NOTIFICATION_PUSH_PLATFORM,
  NOTIFICATION_SUPPRESSION_REASON,
  getNotificationChannelName,
  parseNotificationCategory,
  parseNotificationChannel,
  parseNotificationDeliveryStatus,
  parseNotificationPushPlatform,
  parseNotificationSuppressionReason,
} from '../contracts/index.js';
import type { NotificationDeliveryEntity } from '../entities/notification-delivery.entity.js';
import type { NotificationRecipientEntity } from '../entities/notification-recipient.entity.js';
import type { NotificationEntity } from '../entities/notification.entity.js';
import type { NotificationChannelCode } from '../enum/notifications.enum.js';
import { resolveNotificationRuntimeConfig } from '../helpers/notification-config.helper.js';
import {
  buildDeliveryIdempotencyKey,
  calculateChannelEstimatedCost,
  calculateSmsSegments,
  chunkItemsIntoBatches,
  computeExponentialBackoffRetryAt,
  resolveCurrentQuotaPeriodKeys,
  validateAndNormalizeDestination,
} from '../helpers/notification-delivery-policy.helper.js';
import {
  DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES,
  extractTemplateVariables,
  renderNotificationTemplateContent,
} from '../helpers/notification-template.helper.js';
import { NotificationsMapper } from '../mappers/notifications.mapper.js';
import { NotificationChannelsRepository } from '../repositories/notification-channels.repository.js';
import type {
  CreateNotificationSuppressionRequest,
  ListNotificationDeliveriesQuery,
  ListNotificationSuppressionsQuery,
  ListNotificationTemplatesQuery,
  PreviewNotificationTemplateRequest,
  RegisterPushSubscriptionRequest,
  UpdateDeliveryStatusWebhookRequest,
  UpsertNotificationTemplateRequest,
} from '../requests/notifications.requests.js';
import type {
  NotificationDeliveryItemResponse,
  NotificationPushSubscriptionItemResponse,
  NotificationQuotaAndCostSummaryResponse,
  NotificationSuppressionItemResponse,
  NotificationTemplateItemResponse,
  NotificationTemplatePreviewResponse,
  RetryDueDeliveriesResponse,
} from '../responses/notifications.response.js';
import type {
  NotificationBatchDeliverySummaryView,
  NotificationChannelQuotaItemView,
  NotificationDeliveryItemView,
  ResolvedNotificationRuntimeConfig,
} from '../types/notifications.types.js';

interface PendingChannelDeliveryTask {
  readonly notification: NotificationEntity;
  readonly recipientEntry: NotificationRecipientEntity | null;
  readonly recipientUserId: number;
  readonly channel: NotificationChannelCode;
  readonly destination: string;
  readonly contact: UserNotificationContactView | undefined;
  readonly templateCode: string | null;
  readonly templateVariables: Record<string, unknown>;
  readonly locale: string;
  readonly callerIdempotencyKey?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
}

@Injectable()
export class NotificationChannelsService {
  constructor(
    private readonly channelsRepo: NotificationChannelsRepository,
    private readonly adapterRegistry: NotificationChannelAdapterRegistry,
    private readonly mapper: NotificationsMapper,
    @Optional() private readonly auditLogService?: AuditLogService | null,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService?: IUsersPublicService | null,
  ) {}

  // ==================== 1. TEMPLATE ENGINE & CRUD ====================

  public async listTemplates(
    query: ListNotificationTemplatesQuery,
  ): Promise<PaginatedResult<NotificationTemplateItemResponse>> {
    const pagination = resolvePagination(query, {
      settingPrefix: 'notifications.pagination',
    });
    const paginated = await this.channelsRepo.findPaginatedTemplates({
      ...pagination,
      search: query.search,
      channel: query.channel,
      category: query.category,
      locale: query.locale,
      isActive: query.isActive,
    });

    const items = paginated.items.map((item) => this.mapper.toTemplateItemView(item));
    return createPaginatedResult(items, paginated.total, paginated.page, paginated.limit);
  }

  public async upsertTemplate(
    input: UpsertNotificationTemplateRequest,
    actor?: UserIdentity,
  ): Promise<NotificationTemplateItemResponse> {
    const code = input.code.trim().toUpperCase();
    const channel = parseNotificationChannel(input.channel);
    const category =
      input.category !== undefined
        ? parseNotificationCategory(input.category)
        : NOTIFICATION_CATEGORY.SYSTEM;
    const locale = input.locale?.trim().toLowerCase() || 'vi';

    const autoVariables = [
      ...new Set([
        ...(input.variables ?? []),
        ...extractTemplateVariables(input.subjectTemplate),
        ...extractTemplateVariables(input.bodyTemplate),
        ...extractTemplateVariables(input.htmlTemplate),
      ]),
    ];

    const saved = await this.channelsRepo.upsertTemplate({
      code,
      name: input.name.trim(),
      channel,
      category,
      locale,
      subjectTemplate: input.subjectTemplate?.trim() || null,
      bodyTemplate: input.bodyTemplate.trim(),
      htmlTemplate: input.htmlTemplate?.trim() || null,
      variablesJson: JSON.stringify(autoVariables),
      isActive: input.isActive ?? true,
      organizationUnitId: input.organizationUnitId ?? null,
    });

    await this.recordAudit(
      actor,
      'UPSERT_NOTIFICATION_TEMPLATE',
      NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE,
      String(saved.id),
      null,
      { code, channel, locale },
    );

    return this.mapper.toTemplateItemView(saved);
  }

  public async deleteTemplate(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ deleted: true; id: number }> {
    const existing = await this.channelsRepo.findTemplateById(id);
    if (!existing) {
      throw new NotFoundAppException('notifications.templateNotFound', { id });
    }
    if (existing.isSystem) {
      throw new ForbiddenAppException('notifications.cannotDeleteSystemTemplate');
    }

    await this.channelsRepo.deleteTemplateById(id);
    await this.recordAudit(
      actor,
      'DELETE_NOTIFICATION_TEMPLATE',
      NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE,
      String(id),
      { code: existing.code, channel: existing.channel },
      null,
    );

    return { deleted: true, id };
  }

  public async previewTemplate(
    input: PreviewNotificationTemplateRequest,
  ): Promise<NotificationTemplatePreviewResponse> {
    const channel =
      input.channel !== undefined
        ? parseNotificationChannel(input.channel)
        : NOTIFICATION_CHANNEL.EMAIL;
    const locale = input.locale?.trim().toLowerCase() || 'vi';

    let subjectTemplate = input.subjectTemplate ?? null;
    let bodyTemplate = input.bodyTemplate ?? '';
    let htmlTemplate = input.htmlTemplate ?? null;
    const code = input.templateCode?.trim().toUpperCase() || null;

    if (code && !bodyTemplate) {
      const resolved = await this.resolveTemplateByCode(code, channel, locale);
      if (!resolved) {
        throw new NotFoundAppException('notifications.templateNotFound', { code });
      }
      subjectTemplate = resolved.subjectTemplate;
      bodyTemplate = resolved.bodyTemplate;
      htmlTemplate = resolved.htmlTemplate;
    }

    if (!bodyTemplate) {
      throw new BadRequestAppException('notifications.templateBodyRequired');
    }

    const rendered = renderNotificationTemplateContent({
      subjectTemplate,
      bodyTemplate,
      htmlTemplate,
      variables: input.variables ?? {},
    });

    const smsSegs = calculateSmsSegments(rendered.renderedBody);

    return {
      code,
      channel,
      channelName: getNotificationChannelName(channel),
      locale,
      renderedSubject: rendered.renderedSubject,
      renderedBody: rendered.renderedBody,
      renderedHtml: rendered.renderedHtml,
      missingVariables: rendered.missingVariables,
      smsSegmentsCount: smsSegs.segmentsCount,
    };
  }

  public async resolveTemplateByCode(
    code: string,
    channel: NotificationChannelCode,
    locale = 'vi',
  ): Promise<{
    readonly code: string;
    readonly subjectTemplate: string | null;
    readonly bodyTemplate: string;
    readonly htmlTemplate: string | null;
  } | null> {
    const cleanCode = code.trim().toUpperCase();
    const cleanLocale = locale.trim().toLowerCase() || 'vi';
    const dbTemplate = await this.channelsRepo.findTemplateByCodeChannelLocale(
      cleanCode,
      channel,
      cleanLocale,
    );
    if (dbTemplate) {
      return {
        code: dbTemplate.code,
        subjectTemplate: dbTemplate.subjectTemplate ?? null,
        bodyTemplate: dbTemplate.bodyTemplate,
        htmlTemplate: dbTemplate.htmlTemplate ?? null,
      };
    }

    const fallback =
      DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES.find(
        (t) => t.code === cleanCode && t.channel === channel && t.locale === cleanLocale,
      ) ??
      DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES.find(
        (t) => t.code === cleanCode && t.channel === channel,
      ) ??
      DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES.find((t) => t.code === cleanCode);

    if (fallback) {
      return {
        code: fallback.code,
        subjectTemplate: fallback.subjectTemplate,
        bodyTemplate: fallback.bodyTemplate,
        htmlTemplate: fallback.htmlTemplate,
      };
    }
    return null;
  }

  // ==================== 2. MULTI-CHANNEL BATCH DISPATCH, QUOTA, SUPPRESSION & RETRY ====================

  public async dispatchExternalChannelDeliveries(params: {
    notification: NotificationEntity;
    savedRecipients: readonly NotificationRecipientEntity[];
    recipientUserIds: readonly number[];
    templateCode?: string | null | undefined;
    templateVariables?: Record<string, unknown> | null | undefined;
    locale?: string | undefined;
    callerIdempotencyKey?: string | null | undefined;
    metadata?: Record<string, unknown> | null | undefined;
    runtimeConfig: ResolvedNotificationRuntimeConfig;
  }): Promise<{
    readonly deliveries: NotificationDeliveryItemView[];
    readonly summary: NotificationBatchDeliverySummaryView;
  }> {
    const {
      notification,
      savedRecipients,
      recipientUserIds,
      templateCode,
      templateVariables,
      locale = 'vi',
      callerIdempotencyKey,
      metadata,
      runtimeConfig,
    } = params;

    const externalRecipients = savedRecipients.filter(
      (r) => Number(r.channel) !== NOTIFICATION_CHANNEL.IN_APP,
    );

    if (externalRecipients.length === 0) {
      return {
        deliveries: [],
        summary: {
          totalChannelDeliveries: 0,
          totalBatches: 0,
          batchSize: runtimeConfig.dispatchBatchSize,
          queuedCount: 0,
          sentCount: 0,
          deliveredCount: 0,
          failedCount: 0,
          suppressedCount: 0,
          deduplicatedCount: 0,
          totalSmsSegments: 0,
          totalEstimatedCost: 0,
          currency: runtimeConfig.quotaCurrency,
        },
      };
    }

    // Load user contacts in bulk (Email, Phone, FullName, Locale)
    const contacts =
      this.usersPublicService?.findUserContactsByIds && recipientUserIds.length > 0
        ? await this.usersPublicService.findUserContactsByIds(recipientUserIds)
        : [];
    const contactByUserId = new Map<number, UserNotificationContactView>(
      contacts.map((c) => [Number(c.id), c]),
    );

    // Load active push subscriptions if PUSH channel is involved
    const hasPush = externalRecipients.some((r) => Number(r.channel) === NOTIFICATION_CHANNEL.PUSH);
    const pushSubs = hasPush
      ? await this.channelsRepo.findActivePushSubscriptionsByUserIds(recipientUserIds)
      : [];
    const pushSubsByUserId = new Map<number, string[]>();
    for (const sub of pushSubs) {
      const uid = Number(sub.userId);
      const list = pushSubsByUserId.get(uid) ?? [];
      list.push(sub.deviceToken);
      pushSubsByUserId.set(uid, list);
    }

    // Build delivery tasks
    const tasks: PendingChannelDeliveryTask[] = [];
    const destinationOverrides =
      metadata?.destinationOverrides && typeof metadata.destinationOverrides === 'object'
        ? (metadata.destinationOverrides as Record<string, string>)
        : {};

    for (const rec of externalRecipients) {
      const ch = parseNotificationChannel(rec.channel);
      if (!this.isChannelFeatureFlagEnabled(ch, runtimeConfig)) {
        continue;
      }

      const uid = Number(rec.recipientUserId);
      const contact = contactByUserId.get(uid);
      const userLocale = contact?.preferredLocale || locale || 'vi';
      const mergedVars: Record<string, unknown> = {
        title: notification.title,
        content: notification.content,
        fullName: contact?.fullName ?? `User #${uid}`,
        username: contact?.username ?? `user_${uid}`,
        email: contact?.email ?? '',
        phone: contact?.phone ?? '',
        ...(templateVariables ?? {}),
      };

      if (ch === NOTIFICATION_CHANNEL.EMAIL) {
        const dest =
          destinationOverrides.EMAIL ??
          (typeof metadata?.emailOverride === 'string' ? metadata.emailOverride : null) ??
          contact?.email ??
          '';
        tasks.push({
          notification,
          recipientEntry: rec,
          recipientUserId: uid,
          channel: ch,
          destination: dest,
          contact,
          templateCode: templateCode ?? null,
          templateVariables: mergedVars,
          locale: userLocale,
          callerIdempotencyKey,
          metadata,
        });
      } else if (ch === NOTIFICATION_CHANNEL.SMS) {
        const dest =
          destinationOverrides.SMS ??
          (typeof metadata?.phoneOverride === 'string' ? metadata.phoneOverride : null) ??
          contact?.phone ??
          '';
        tasks.push({
          notification,
          recipientEntry: rec,
          recipientUserId: uid,
          channel: ch,
          destination: dest,
          contact,
          templateCode: templateCode ?? null,
          templateVariables: mergedVars,
          locale: userLocale,
          callerIdempotencyKey,
          metadata,
        });
      } else if (ch === NOTIFICATION_CHANNEL.PUSH) {
        const overrideToken =
          destinationOverrides.PUSH ??
          (typeof metadata?.pushTokenOverride === 'string' ? metadata.pushTokenOverride : null);
        const userTokens = overrideToken ? [overrideToken] : (pushSubsByUserId.get(uid) ?? []);

        if (userTokens.length === 0) {
          tasks.push({
            notification,
            recipientEntry: rec,
            recipientUserId: uid,
            channel: ch,
            destination: '',
            contact,
            templateCode: templateCode ?? null,
            templateVariables: mergedVars,
            locale: userLocale,
            callerIdempotencyKey,
            metadata,
          });
        } else {
          for (const token of userTokens) {
            tasks.push({
              notification,
              recipientEntry: rec,
              recipientUserId: uid,
              channel: ch,
              destination: token,
              contact,
              templateCode: templateCode ?? null,
              templateVariables: mergedVars,
              locale: userLocale,
              callerIdempotencyKey,
              metadata,
            });
          }
        }
      }
    }

    // Preload active suppressions per channel to avoid N+1
    const suppressedByChannel = new Map<NotificationChannelCode, Set<string>>();
    for (const ch of [
      NOTIFICATION_CHANNEL.EMAIL,
      NOTIFICATION_CHANNEL.SMS,
      NOTIFICATION_CHANNEL.PUSH,
    ] as const) {
      const dests = tasks.filter((t) => t.channel === ch).map((t) => t.destination);
      if (dests.length > 0) {
        const blocked = await this.channelsRepo.findActiveSuppressionsForDestinations(ch, dests);
        suppressedByChannel.set(ch, blocked);
      } else {
        suppressedByChannel.set(ch, new Set());
      }
    }

    // Chunk into batches according to dispatchBatchSize
    const batches = chunkItemsIntoBatches(
      tasks,
      runtimeConfig.dispatchBatchSize,
      notification.code,
    );

    const deliveryViews: NotificationDeliveryItemView[] = [];
    let queuedCount = 0;
    let sentCount = 0;
    let deliveredCount = 0;
    let failedCount = 0;
    let suppressedCount = 0;
    let deduplicatedCount = 0;
    let totalSmsSegments = 0;
    let totalEstimatedCost = 0;

    for (const batch of batches) {
      for (const task of batch.items) {
        const result = await this.executeSingleDeliveryTask({
          task,
          batchKey: batch.batchKey,
          suppressedSet: suppressedByChannel.get(task.channel) ?? new Set(),
          runtimeConfig,
        });

        if (result.deduplicated) {
          deduplicatedCount++;
        }

        const view = this.mapper.toDeliveryItemView(result.entity, task.locale);
        deliveryViews.push(view);

        switch (view.status) {
          case NOTIFICATION_DELIVERY_STATUS.QUEUED:
            queuedCount++;
            break;
          case NOTIFICATION_DELIVERY_STATUS.SENT:
            sentCount++;
            break;
          case NOTIFICATION_DELIVERY_STATUS.DELIVERED:
            deliveredCount++;
            break;
          case NOTIFICATION_DELIVERY_STATUS.SUPPRESSED:
            suppressedCount++;
            break;
          default:
            failedCount++;
            break;
        }

        if (
          view.channel === NOTIFICATION_CHANNEL.SMS &&
          (view.status === NOTIFICATION_DELIVERY_STATUS.SENT ||
            view.status === NOTIFICATION_DELIVERY_STATUS.DELIVERED)
        ) {
          totalSmsSegments += view.segmentsCount;
        }
        if (
          view.status === NOTIFICATION_DELIVERY_STATUS.SENT ||
          view.status === NOTIFICATION_DELIVERY_STATUS.DELIVERED
        ) {
          totalEstimatedCost = Number((totalEstimatedCost + view.estimatedCost).toFixed(4));
        }
      }
    }

    return {
      deliveries: deliveryViews,
      summary: {
        totalChannelDeliveries: deliveryViews.length,
        totalBatches: batches.length,
        batchSize: runtimeConfig.dispatchBatchSize,
        queuedCount,
        sentCount,
        deliveredCount,
        failedCount,
        suppressedCount,
        deduplicatedCount,
        totalSmsSegments,
        totalEstimatedCost,
        currency: runtimeConfig.quotaCurrency,
      },
    };
  }

  private async executeSingleDeliveryTask(params: {
    task: PendingChannelDeliveryTask;
    batchKey: string;
    suppressedSet: Set<string>;
    runtimeConfig: ResolvedNotificationRuntimeConfig;
  }): Promise<{ readonly entity: NotificationDeliveryEntity; readonly deduplicated: boolean }> {
    const { task, batchKey, suppressedSet, runtimeConfig } = params;
    const providerCode = this.resolveProviderCodeForChannel(task.channel, runtimeConfig);
    const destValidation = validateAndNormalizeDestination(task.channel, task.destination);
    const normalizedDest = destValidation.normalizedDestination || task.destination || 'MISSING';

    // 1. Idempotency check (prevent duplicate sends!)
    const idempotencyKey = buildDeliveryIdempotencyKey({
      callerIdempotencyKey: task.callerIdempotencyKey,
      notificationId: Number(task.notification.id),
      recipientUserId: task.recipientUserId,
      channel: task.channel,
      destination: normalizedDest,
    });

    const existingDelivery = await this.channelsRepo.findDeliveryByIdempotencyKey(idempotencyKey);
    if (existingDelivery) {
      return { entity: existingDelivery, deduplicated: true };
    }

    // 2. Render template if templateCode provided, else use notification title/content
    let renderedSubject: string | null = task.notification.title;
    let renderedBody = task.notification.content;
    let renderedHtml: string | null = null;

    if (task.templateCode) {
      const tpl = await this.resolveTemplateByCode(task.templateCode, task.channel, task.locale);
      if (tpl) {
        const rendered = renderNotificationTemplateContent({
          subjectTemplate: tpl.subjectTemplate ?? task.notification.title,
          bodyTemplate: tpl.bodyTemplate,
          htmlTemplate: tpl.htmlTemplate,
          variables: task.templateVariables,
        });
        renderedSubject = rendered.renderedSubject ?? task.notification.title;
        renderedBody = rendered.renderedBody || task.notification.content;
        renderedHtml = rendered.renderedHtml;
      }
    }

    // 3. Calculate SMS segments & estimated cost
    const segmentsCount =
      task.channel === NOTIFICATION_CHANNEL.SMS
        ? calculateSmsSegments(renderedBody).segmentsCount
        : 1;
    const estimatedCost = calculateChannelEstimatedCost(task.channel, segmentsCount, runtimeConfig);
    const now = new Date();
    const periodKeys = resolveCurrentQuotaPeriodKeys(now);

    // 4. Check destination format validity & Suppression List
    const lookupKey = normalizedDest.toLowerCase();
    if (!destValidation.valid || suppressedSet.has(lookupKey)) {
      const isSuppressedAlready = suppressedSet.has(lookupKey);
      const reasonCode =
        destValidation.invalidReason ?? NOTIFICATION_SUPPRESSION_REASON.HARD_BOUNCE;

      if (
        !isSuppressedAlready &&
        !destValidation.valid &&
        normalizedDest !== 'MISSING' &&
        runtimeConfig.autoSuppressOnPermanentFailure
      ) {
        await this.channelsRepo.upsertSuppression({
          channel: task.channel,
          destination: normalizedDest,
          reason: reasonCode,
          providerCode,
          errorCode: 'INVALID_DESTINATION_FORMAT',
          errorMessage: destValidation.errorMessage ?? 'Invalid destination format',
          sourceNotificationId: Number(task.notification.id),
        });
        suppressedSet.add(lookupKey);
      }

      const suppressedEntity = this.channelsRepo.repository.create({
        notificationId: Number(task.notification.id),
        recipientId: task.recipientEntry ? Number(task.recipientEntry.id) : null,
        recipientUserId: task.recipientUserId,
        organizationUnitId: task.notification.organizationUnitId ?? null,
        channel: task.channel,
        providerCode,
        destination: normalizedDest,
        templateCode: task.templateCode ?? null,
        renderedSubject,
        renderedBody,
        idempotencyKey,
        batchKey,
        status: NOTIFICATION_DELIVERY_STATUS.SUPPRESSED,
        errorType: NOTIFICATION_ERROR_TYPE.SUPPRESSED,
        errorCode: isSuppressedAlready ? 'DESTINATION_SUPPRESSED' : 'INVALID_DESTINATION_FORMAT',
        errorMessage: isSuppressedAlready
          ? `Destination ${normalizedDest} is in active suppression list`
          : (destValidation.errorMessage ?? 'Invalid destination address or token'),
        attemptCount: 0,
        maxAttempts: runtimeConfig.retryMaxAttempts,
        nextRetryAt: null,
        providerMessageId: null,
        segmentsCount,
        estimatedCost: '0.0000',
        currency: runtimeConfig.quotaCurrency,
        queuedAt: now,
        sentAt: null,
        deliveredAt: null,
        failedAt: now,
      });

      const savedSuppressed = await this.channelsRepo.saveEntity(suppressedEntity);
      await this.channelsRepo.recordQuotaDelta({
        channel: task.channel,
        providerCode,
        dailyPeriodKey: periodKeys.dailyPeriodKey,
        monthlyPeriodKey: periodKeys.monthlyPeriodKey,
        currency: runtimeConfig.quotaCurrency,
        suppressedDelta: 1,
      });

      return { entity: savedSuppressed, deduplicated: false };
    }

    // 5. Check Provider Quota & Budget Limit before sending
    const quotaCheck = await this.checkQuotaAvailability({
      channel: task.channel,
      providerCode,
      segmentsToConsume: segmentsCount,
      costToConsume: estimatedCost,
      runtimeConfig,
      now,
    });

    if (!quotaCheck.allowed && runtimeConfig.quotaHardStopOnExceed) {
      const quotaFailedEntity = this.channelsRepo.repository.create({
        notificationId: Number(task.notification.id),
        recipientId: task.recipientEntry ? Number(task.recipientEntry.id) : null,
        recipientUserId: task.recipientUserId,
        organizationUnitId: task.notification.organizationUnitId ?? null,
        channel: task.channel,
        providerCode,
        destination: normalizedDest,
        templateCode: task.templateCode ?? null,
        renderedSubject,
        renderedBody,
        idempotencyKey,
        batchKey,
        status: NOTIFICATION_DELIVERY_STATUS.FAILED,
        errorType: NOTIFICATION_ERROR_TYPE.QUOTA_EXCEEDED,
        errorCode: quotaCheck.errorCode ?? 'QUOTA_EXCEEDED',
        errorMessage: quotaCheck.errorMessage ?? 'Provider quota or monthly budget exceeded',
        attemptCount: 1,
        maxAttempts: runtimeConfig.retryMaxAttempts,
        nextRetryAt: null,
        providerMessageId: null,
        segmentsCount,
        estimatedCost: '0.0000',
        currency: runtimeConfig.quotaCurrency,
        queuedAt: now,
        sentAt: null,
        deliveredAt: null,
        failedAt: now,
      });

      const savedQuotaFailed = await this.channelsRepo.saveEntity(quotaFailedEntity);
      await this.channelsRepo.recordQuotaDelta({
        channel: task.channel,
        providerCode,
        dailyPeriodKey: periodKeys.dailyPeriodKey,
        monthlyPeriodKey: periodKeys.monthlyPeriodKey,
        currency: runtimeConfig.quotaCurrency,
        failedDelta: 1,
      });

      return { entity: savedQuotaFailed, deduplicated: false };
    }

    // 6. Create QUEUED delivery record and invoke channel adapter
    const initialEntity = this.channelsRepo.repository.create({
      notificationId: Number(task.notification.id),
      recipientId: task.recipientEntry ? Number(task.recipientEntry.id) : null,
      recipientUserId: task.recipientUserId,
      organizationUnitId: task.notification.organizationUnitId ?? null,
      channel: task.channel,
      providerCode,
      destination: normalizedDest,
      templateCode: task.templateCode ?? null,
      renderedSubject,
      renderedBody,
      idempotencyKey,
      batchKey,
      status: NOTIFICATION_DELIVERY_STATUS.QUEUED,
      errorType: NOTIFICATION_ERROR_TYPE.NONE,
      errorCode: null,
      errorMessage: null,
      attemptCount: 0,
      maxAttempts: runtimeConfig.retryMaxAttempts,
      nextRetryAt: null,
      providerMessageId: null,
      segmentsCount,
      estimatedCost: estimatedCost.toFixed(4),
      currency: runtimeConfig.quotaCurrency,
      queuedAt: now,
      sentAt: null,
      deliveredAt: null,
      failedAt: null,
    });

    const queuedEntity = await this.channelsRepo.saveEntity(initialEntity);
    const updatedEntity = await this.attemptProviderSend({
      delivery: queuedEntity,
      renderedHtml,
      metadata: task.metadata,
      runtimeConfig,
      suppressedSet,
    });

    return { entity: updatedEntity, deduplicated: false };
  }

  private async attemptProviderSend(params: {
    delivery: NotificationDeliveryEntity;
    renderedHtml?: string | null | undefined;
    metadata?: Record<string, unknown> | null | undefined;
    runtimeConfig: ResolvedNotificationRuntimeConfig;
    suppressedSet?: Set<string> | undefined;
  }): Promise<NotificationDeliveryEntity> {
    const { delivery, renderedHtml, metadata, runtimeConfig, suppressedSet } = params;
    const channel = parseNotificationChannel(delivery.channel);
    const adapter = this.adapterRegistry.getAdapter(channel);
    const now = new Date();
    const periodKeys = resolveCurrentQuotaPeriodKeys(now);

    delivery.attemptCount = Number(delivery.attemptCount ?? 0) + 1;

    if (!adapter) {
      delivery.status = NOTIFICATION_DELIVERY_STATUS.FAILED;
      delivery.errorType = NOTIFICATION_ERROR_TYPE.PERMANENT;
      delivery.errorCode = 'ADAPTER_NOT_FOUND';
      delivery.errorMessage = `No provider adapter registered for channel ${channel}`;
      delivery.failedAt = now;
      delivery.nextRetryAt = null;
      return this.channelsRepo.saveEntity(delivery);
    }

    const sendResult = await adapter.send({
      channel,
      providerCode: delivery.providerCode,
      destination: delivery.destination,
      subject: delivery.renderedSubject,
      body: delivery.renderedBody,
      htmlBody: renderedHtml ?? null,
      fromAddress: runtimeConfig.emailFromAddress,
      fromName: runtimeConfig.emailFromName,
      senderId: runtimeConfig.smsSenderId,
      idempotencyKey: delivery.idempotencyKey,
      metadata: metadata ?? null,
    });

    if (sendResult.success) {
      delivery.status =
        sendResult.status === 'DELIVERED'
          ? NOTIFICATION_DELIVERY_STATUS.DELIVERED
          : NOTIFICATION_DELIVERY_STATUS.SENT;
      delivery.providerMessageId = sendResult.providerMessageId;
      delivery.errorType = NOTIFICATION_ERROR_TYPE.NONE;
      delivery.errorCode = null;
      delivery.errorMessage = null;
      delivery.nextRetryAt = null;
      delivery.sentAt = now;
      delivery.deliveredAt = sendResult.status === 'DELIVERED' ? now : null;
      delivery.failedAt = null;

      const saved = await this.channelsRepo.saveEntity(delivery);
      await this.channelsRepo.recordQuotaDelta({
        channel,
        providerCode: delivery.providerCode,
        dailyPeriodKey: periodKeys.dailyPeriodKey,
        monthlyPeriodKey: periodKeys.monthlyPeriodKey,
        currency: delivery.currency,
        sentDelta: 1,
        deliveredDelta: sendResult.status === 'DELIVERED' ? 1 : 0,
        segmentsDelta: Number(delivery.segmentsCount ?? 1),
        costDelta: Number(delivery.estimatedCost ?? 0),
      });
      return saved;
    }

    // Handle failure: Transient vs Permanent
    const isTransient =
      sendResult.errorType === NOTIFICATION_ERROR_TYPE.TRANSIENT ||
      sendResult.errorType === NOTIFICATION_ERROR_TYPE.RATE_LIMITED;

    const canRetry =
      isTransient &&
      runtimeConfig.retryEnabled &&
      delivery.attemptCount < Number(delivery.maxAttempts ?? runtimeConfig.retryMaxAttempts);

    delivery.errorType = sendResult.errorType;
    delivery.errorCode = sendResult.errorCode;
    delivery.errorMessage = sendResult.errorMessage;

    if (canRetry) {
      delivery.status = NOTIFICATION_DELIVERY_STATUS.QUEUED;
      delivery.nextRetryAt = computeExponentialBackoffRetryAt(
        delivery.attemptCount,
        runtimeConfig.retryBaseDelaySec,
        now,
      );
      return this.channelsRepo.saveEntity(delivery);
    }

    // Permanent failure or exhausted retries
    delivery.status = NOTIFICATION_DELIVERY_STATUS.FAILED;
    delivery.nextRetryAt = null;
    delivery.failedAt = now;
    delivery.estimatedCost = '0.0000';

    const savedFailed = await this.channelsRepo.saveEntity(delivery);
    await this.channelsRepo.recordQuotaDelta({
      channel,
      providerCode: delivery.providerCode,
      dailyPeriodKey: periodKeys.dailyPeriodKey,
      monthlyPeriodKey: periodKeys.monthlyPeriodKey,
      currency: delivery.currency,
      failedDelta: 1,
    });

    if (sendResult.shouldSuppressDestination && runtimeConfig.autoSuppressOnPermanentFailure) {
      const reason =
        sendResult.suppressionReason ??
        (channel === NOTIFICATION_CHANNEL.PUSH
          ? NOTIFICATION_SUPPRESSION_REASON.UNREGISTERED_TOKEN
          : NOTIFICATION_SUPPRESSION_REASON.HARD_BOUNCE);

      await this.channelsRepo.upsertSuppression({
        channel,
        destination: delivery.destination,
        reason,
        providerCode: delivery.providerCode,
        errorCode: sendResult.errorCode,
        errorMessage: sendResult.errorMessage,
        sourceNotificationId: Number(delivery.notificationId),
      });
      suppressedSet?.add(delivery.destination.toLowerCase());

      if (channel === NOTIFICATION_CHANNEL.PUSH) {
        await this.channelsRepo.deactivatePushToken(
          delivery.destination,
          sendResult.errorMessage ?? 'Unregistered push token',
        );
      }
    }

    return savedFailed;
  }

  // ==================== 3. RETRY & WEBHOOK STATUS TRACKING ====================

  public async retrySingleDelivery(
    deliveryId: number,
    actor?: UserIdentity,
    locale = 'vi',
  ): Promise<NotificationDeliveryItemResponse> {
    const delivery = await this.channelsRepo.findDeliveryById(deliveryId);
    if (!delivery) {
      throw new NotFoundAppException('notifications.deliveryNotFound', { id: deliveryId });
    }

    // Idempotency guard: if already SENT or DELIVERED, do NOT resend!
    if (
      Number(delivery.status) === NOTIFICATION_DELIVERY_STATUS.SENT ||
      Number(delivery.status) === NOTIFICATION_DELIVERY_STATUS.DELIVERED
    ) {
      return this.mapper.toDeliveryItemView(delivery, locale);
    }

    if (Number(delivery.status) === NOTIFICATION_DELIVERY_STATUS.SUPPRESSED) {
      throw new BadRequestAppException('notifications.cannotRetrySuppressedDestination');
    }

    const runtimeConfig = resolveNotificationRuntimeConfig(delivery.organizationUnitId ?? null);

    // Check if destination was suppressed in the meantime
    const activeBlocked = await this.channelsRepo.findActiveSuppressionsForDestinations(
      Number(delivery.channel),
      [delivery.destination],
    );
    if (activeBlocked.has(delivery.destination.trim().toLowerCase())) {
      delivery.status = NOTIFICATION_DELIVERY_STATUS.SUPPRESSED;
      delivery.errorType = NOTIFICATION_ERROR_TYPE.SUPPRESSED;
      delivery.errorCode = 'DESTINATION_SUPPRESSED';
      delivery.errorMessage = 'Destination is currently in active suppression list';
      delivery.nextRetryAt = null;
      const savedSuppressed = await this.channelsRepo.saveEntity(delivery);
      return this.mapper.toDeliveryItemView(savedSuppressed, locale);
    }

    const updated = await this.attemptProviderSend({
      delivery,
      runtimeConfig,
    });

    await this.recordAudit(
      actor,
      'RETRY_NOTIFICATION_DELIVERY',
      NOTIFICATIONS_AUDIT_META.ENTITY_DELIVERY,
      String(deliveryId),
      null,
      { status: updated.status, attemptCount: updated.attemptCount },
    );

    return this.mapper.toDeliveryItemView(updated, locale);
  }

  public async retryDueDeliveries(
    now: Date = new Date(),
    actor?: UserIdentity,
    locale = 'vi',
  ): Promise<RetryDueDeliveriesResponse> {
    const runtimeConfig = resolveNotificationRuntimeConfig(null);
    const dueList = await this.channelsRepo.findDueRetryDeliveries(
      now,
      runtimeConfig.dispatchBatchSize,
    );

    let retriedCount = 0;
    let succeededCount = 0;
    let rescheduledCount = 0;
    let permanentFailedCount = 0;
    const updatedViews: NotificationDeliveryItemView[] = [];

    for (const delivery of dueList) {
      if (
        Number(delivery.status) === NOTIFICATION_DELIVERY_STATUS.SENT ||
        Number(delivery.status) === NOTIFICATION_DELIVERY_STATUS.DELIVERED
      ) {
        continue;
      }

      retriedCount++;
      const updated = await this.attemptProviderSend({
        delivery,
        runtimeConfig,
      });
      const view = this.mapper.toDeliveryItemView(updated, locale);
      updatedViews.push(view);

      if (
        view.status === NOTIFICATION_DELIVERY_STATUS.SENT ||
        view.status === NOTIFICATION_DELIVERY_STATUS.DELIVERED
      ) {
        succeededCount++;
      } else if (view.status === NOTIFICATION_DELIVERY_STATUS.QUEUED) {
        rescheduledCount++;
      } else {
        permanentFailedCount++;
      }
    }

    if (retriedCount > 0) {
      await this.recordAudit(
        actor,
        'RETRY_DUE_NOTIFICATION_DELIVERIES',
        NOTIFICATIONS_AUDIT_META.ENTITY_DELIVERY,
        'batch',
        null,
        {
          scannedCount: dueList.length,
          retriedCount,
          succeededCount,
          rescheduledCount,
          permanentFailedCount,
        },
      );
    }

    return {
      scannedCount: dueList.length,
      retriedCount,
      succeededCount,
      rescheduledCount,
      permanentFailedCount,
      items: updatedViews,
    };
  }

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
          input.suppressionReason ??
          (Number(delivery.channel) === NOTIFICATION_CHANNEL.PUSH
            ? NOTIFICATION_SUPPRESSION_REASON.UNREGISTERED_TOKEN
            : NOTIFICATION_SUPPRESSION_REASON.HARD_BOUNCE);

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
      NOTIFICATIONS_AUDIT_META.ENTITY_DELIVERY,
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

  // ==================== 4. SUPPRESSION LIST MANAGEMENT ====================

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
      NOTIFICATIONS_AUDIT_META.ENTITY_SUPPRESSION,
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
      NOTIFICATIONS_AUDIT_META.ENTITY_SUPPRESSION,
      String(id),
      null,
      { isActive: false },
    );
    return { removed: true, id };
  }

  // ==================== 5. PUSH SUBSCRIPTIONS MANAGEMENT ====================

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
      NOTIFICATIONS_AUDIT_META.ENTITY_PUSH_SUBSCRIPTION,
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
      NOTIFICATIONS_AUDIT_META.ENTITY_PUSH_SUBSCRIPTION,
      String(subscriptionId),
      { userId },
      null,
    );
    return { removed: true, id: subscriptionId };
  }

  // ==================== 6. QUOTA & COST TRACKING SUMMARY ====================

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

  private async checkQuotaAvailability(params: {
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

  private resolveProviderCodeForChannel(
    channel: NotificationChannelCode,
    runtimeConfig: ResolvedNotificationRuntimeConfig,
  ): string {
    if (channel === NOTIFICATION_CHANNEL.EMAIL) {
      return (runtimeConfig.emailProvider || 'CONSOLE').trim().toUpperCase();
    }
    if (channel === NOTIFICATION_CHANNEL.SMS) {
      return (runtimeConfig.smsProvider || 'CONSOLE').trim().toUpperCase();
    }
    if (channel === NOTIFICATION_CHANNEL.PUSH) {
      return (runtimeConfig.pushProvider || 'CONSOLE').trim().toUpperCase();
    }
    return 'IN_APP';
  }

  private isChannelFeatureFlagEnabled(
    channel: NotificationChannelCode,
    runtimeConfig: ResolvedNotificationRuntimeConfig,
  ): boolean {
    if (channel === NOTIFICATION_CHANNEL.EMAIL) return runtimeConfig.emailFeatureEnabled;
    if (channel === NOTIFICATION_CHANNEL.SMS) return runtimeConfig.smsFeatureEnabled;
    if (channel === NOTIFICATION_CHANNEL.PUSH) return runtimeConfig.pushFeatureEnabled;
    return runtimeConfig.inAppFeatureEnabled;
  }

  private async recordAudit(
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
        module: NOTIFICATIONS_AUDIT_META.MODULE,
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
