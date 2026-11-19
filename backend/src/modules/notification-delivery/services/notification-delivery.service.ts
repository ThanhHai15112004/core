import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  NotFoundAppException,
  PROVIDER_TYPE,
  ProviderRegistryService,
  type PaginatedResult,
  type ProviderTypeName,
  defaultCodeRegistry,
  defaultProviderRegistry,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  BaseMessagePublisherProvider,
  JOB_PRIORITIES,
  QUEUES,
  type MessageEnvelope,
} from '@packages/messaging/index.js';
import {
  DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES,
  type ITemplatesPublicService,
  TEMPLATES_PUBLIC_SERVICE,
  renderNotificationTemplateContent,
} from '@modules/templates/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  type UserNotificationContactView,
} from '@modules/users/contracts/index.js';
import { NotificationChannelAdapterRegistry } from '../adapters/notification-channel.adapters.js';
import {
  type INotificationDeliveryPublicService,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_AUDIT_META,
  NOTIFICATION_DELIVERY_CODE_TYPES,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_ERROR_TYPE,
  NOTIFICATION_SUPPRESSION_REASON,
  parseNotificationCategory,
  parseNotificationChannel,
  type NotificationChannelCode,
} from '../contracts/index.js';
import type { NotificationDeliveryEntity } from '../entities/notification-delivery.entity.js';
import { resolveNotificationRuntimeConfig } from '../helpers/notification-delivery-config.helper.js';
import {
  buildDeliveryIdempotencyKey,
  calculateChannelEstimatedCost,
  calculateSmsSegments,
  chunkItemsIntoBatches,
  computeExponentialBackoffRetryAt,
  resolveCurrentQuotaPeriodKeys,
  validateAndNormalizeDestination,
} from '../helpers/notification-delivery-policy.helper.js';
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
  RetryDueDeliveriesResponse,
} from '../responses/notification-delivery.response.js';
import type {
  DispatchExternalChannelNotificationInput,
  DispatchExternalChannelRecipientEntryInput,
  NotificationBatchDeliverySummaryView,
  NotificationDeliveryItemView,
  ResolvedNotificationRuntimeConfig,
} from '../types/notification-delivery.types.js';
import { NotificationDeliveryGovernanceService } from './notification-delivery-governance.service.js';

interface PendingChannelDeliveryTask {
  readonly notification: DispatchExternalChannelNotificationInput;
  readonly recipientEntry: DispatchExternalChannelRecipientEntryInput | null;
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
export class NotificationDeliveryService implements INotificationDeliveryPublicService {
  private readonly governanceService: NotificationDeliveryGovernanceService;
  private readonly providerRegistry: ProviderRegistryService;

  constructor(
    private readonly channelsRepo: NotificationDeliveryRepository,
    private readonly adapterRegistry: NotificationChannelAdapterRegistry,
    private readonly mapper: NotificationDeliveryMapper = new NotificationDeliveryMapper(),
    @Optional() private readonly auditLogService?: AuditLogService | null,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService?: IUsersPublicService | null,
    @Optional()
    private readonly messagePublisher?: BaseMessagePublisherProvider | null,
    @Optional()
    @Inject(TEMPLATES_PUBLIC_SERVICE)
    private readonly templatesPublicService?: ITemplatesPublicService | null,
    @Optional()
    governanceService?: NotificationDeliveryGovernanceService | null,
    @Optional()
    providerRegistry?: ProviderRegistryService | null,
  ) {
    this.governanceService =
      governanceService ??
      new NotificationDeliveryGovernanceService(
        this.channelsRepo,
        this.mapper,
        this.auditLogService,
      );
    this.providerRegistry = providerRegistry ?? defaultProviderRegistry;
    this.registerCodeUsageCheckers();
    this.registerChannelHealthProbes();
  }

  private registerChannelHealthProbes(): void {
    const createProbe = (channel: NotificationChannelCode) => async () => {
      const started = performance.now();
      const adapter = this.adapterRegistry.getAdapter(channel);
      return {
        status: adapter ? ('HEALTHY' as const) : ('DOWN' as const),
        latencyMs: Math.round(performance.now() - started),
        errorCode: adapter ? null : 'ADAPTER_NOT_FOUND',
        errorMessage: adapter ? null : `No notification adapter registered for channel ${channel}`,
        details: { channel },
      };
    };
    this.providerRegistry.registerHealthProbe(
      PROVIDER_TYPE.EMAIL,
      '*',
      createProbe(NOTIFICATION_CHANNEL.EMAIL),
    );
    this.providerRegistry.registerHealthProbe(
      PROVIDER_TYPE.SMS,
      '*',
      createProbe(NOTIFICATION_CHANNEL.SMS),
    );
  }

  private registerCodeUsageCheckers(): void {
    defaultCodeRegistry.registerUsageChecker(
      NOTIFICATION_DELIVERY_CODE_TYPES.DELIVERY_STATUS,
      NOTIFICATION_DELIVERY_CODE_TYPES.DELIVERY_STATUS,
      async () => 0,
    );
    defaultCodeRegistry.registerUsageChecker(
      NOTIFICATION_DELIVERY_CODE_TYPES.SUPPRESSION_REASON,
      NOTIFICATION_DELIVERY_CODE_TYPES.SUPPRESSION_REASON,
      async () => 0,
    );
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

    if (this.templatesPublicService?.resolveTemplateByCode) {
      return this.templatesPublicService.resolveTemplateByCode(cleanCode, channel, cleanLocale);
    }

    const repoWithTemplates = this.channelsRepo as unknown as {
      findTemplateByCodeChannelLocale?: (
        c: string,
        ch: number,
        loc: string,
      ) => Promise<{
        code: string;
        subjectTemplate?: string | null;
        bodyTemplate: string;
        htmlTemplate?: string | null;
      } | null>;
    };
    if (repoWithTemplates.findTemplateByCodeChannelLocale) {
      const dbTemplate = await repoWithTemplates.findTemplateByCodeChannelLocale(
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

  // ==================== 1. MULTI-CHANNEL BATCH DISPATCH, QUOTA, SUPPRESSION & RETRY ====================

  public async dispatchExternalChannelDeliveries(params: {
    notification: DispatchExternalChannelNotificationInput;
    savedRecipients: readonly DispatchExternalChannelRecipientEntryInput[];
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
    const providerSelection = this.resolveChannelProviderSelection(
      task.channel,
      runtimeConfig,
      task.notification.organizationUnitId ?? null,
    );
    const providerCode = providerSelection.providerCode;
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
        recipientId: task.recipientEntry?.id !== undefined ? Number(task.recipientEntry.id) : null,
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
    const quotaCheck = await this.governanceService.checkQuotaAvailability({
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
        recipientId: task.recipientEntry?.id !== undefined ? Number(task.recipientEntry.id) : null,
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

    if (providerSelection.blockedReason) {
      const blockedEntity = this.channelsRepo.repository.create({
        notificationId: Number(task.notification.id),
        recipientId: task.recipientEntry?.id !== undefined ? Number(task.recipientEntry.id) : null,
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
        errorType: NOTIFICATION_ERROR_TYPE.TRANSIENT,
        errorCode: providerSelection.blockedReason,
        errorMessage: `Provider blocked or paused by Provider Registry policy (${providerSelection.blockedReason})`,
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

      const savedBlocked = await this.channelsRepo.saveEntity(blockedEntity);
      await this.channelsRepo.recordQuotaDelta({
        channel: task.channel,
        providerCode,
        dailyPeriodKey: periodKeys.dailyPeriodKey,
        monthlyPeriodKey: periodKeys.monthlyPeriodKey,
        currency: runtimeConfig.quotaCurrency,
        failedDelta: 1,
      });

      return { entity: savedBlocked, deduplicated: false };
    }

    // 6. Create QUEUED delivery record and invoke channel adapter
    const initialEntity = this.channelsRepo.repository.create({
      notificationId: Number(task.notification.id),
      recipientId: task.recipientEntry?.id !== undefined ? Number(task.recipientEntry.id) : null,
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

    const sendStarted = performance.now();
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
    const sendLatencyMs = performance.now() - sendStarted;
    const registryType = this.mapChannelToProviderType(channel);
    if (registryType && this.providerRegistry.hasProvidersOfType(registryType)) {
      void this.providerRegistry.recordInvocation({
        providerType: registryType,
        providerCode: delivery.providerCode,
        success: sendResult.success,
        latencyMs: sendLatencyMs,
        errorCode: sendResult.errorCode,
        errorMessage: sendResult.errorMessage,
        organizationUnitId: delivery.organizationUnitId ?? null,
      });
    }

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

  // ==================== 2. RETRY & WEBHOOK STATUS TRACKING ====================

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
      NOTIFICATION_DELIVERY_AUDIT_META.ENTITY_DELIVERY,
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
        NOTIFICATION_DELIVERY_AUDIT_META.ENTITY_DELIVERY,
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
    return this.governanceService.updateDeliveryStatusWebhook(deliveryId, input, actor, locale);
  }

  public async listDeliveries(
    query: ListNotificationDeliveriesQuery,
    locale = 'vi',
  ): Promise<PaginatedResult<NotificationDeliveryItemResponse>> {
    return this.governanceService.listDeliveries(query, locale);
  }

  public async listDeliveriesForNotification(
    notificationId: number,
    locale = 'vi',
  ): Promise<NotificationDeliveryItemView[]> {
    return this.governanceService.listDeliveriesForNotification(notificationId, locale);
  }

  // ==================== 3. SUPPRESSION LIST MANAGEMENT ====================

  public async listSuppressions(
    query: ListNotificationSuppressionsQuery,
    locale = 'vi',
  ): Promise<PaginatedResult<NotificationSuppressionItemResponse>> {
    return this.governanceService.listSuppressions(query, locale);
  }

  public async addSuppression(
    input: CreateNotificationSuppressionRequest,
    actor?: UserIdentity,
    locale = 'vi',
  ): Promise<NotificationSuppressionItemResponse> {
    return this.governanceService.addSuppression(input, actor, locale);
  }

  public async removeSuppression(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ removed: boolean; id: number }> {
    return this.governanceService.removeSuppression(id, actor);
  }

  // ==================== 4. PUSH SUBSCRIPTIONS MANAGEMENT ====================

  public async listUserPushSubscriptions(
    userId: number,
  ): Promise<NotificationPushSubscriptionItemResponse[]> {
    return this.governanceService.listUserPushSubscriptions(userId);
  }

  public async registerPushSubscription(
    userId: number,
    input: RegisterPushSubscriptionRequest,
    actor?: UserIdentity,
  ): Promise<NotificationPushSubscriptionItemResponse> {
    return this.governanceService.registerPushSubscription(userId, input, actor);
  }

  public async unregisterPushSubscription(
    userId: number,
    subscriptionId: number,
    actor?: UserIdentity,
  ): Promise<{ removed: true; id: number }> {
    return this.governanceService.unregisterPushSubscription(userId, subscriptionId, actor);
  }

  // ==================== 5. QUOTA & COST TRACKING SUMMARY ====================

  public async getQuotaAndCostSummary(
    organizationUnitId?: number | null,
    now: Date = new Date(),
  ): Promise<NotificationQuotaAndCostSummaryResponse> {
    return this.governanceService.getQuotaAndCostSummary(organizationUnitId, now);
  }

  private mapChannelToProviderType(channel: NotificationChannelCode): ProviderTypeName | null {
    if (channel === NOTIFICATION_CHANNEL.EMAIL) return PROVIDER_TYPE.EMAIL;
    if (channel === NOTIFICATION_CHANNEL.SMS) return PROVIDER_TYPE.SMS;
    return null;
  }

  private resolveChannelProviderSelection(
    channel: NotificationChannelCode,
    runtimeConfig: ResolvedNotificationRuntimeConfig,
    organizationUnitId?: number | null,
  ): { readonly providerCode: string; readonly blockedReason: string | null } {
    const registryType = this.mapChannelToProviderType(channel);
    if (registryType && this.providerRegistry.hasProvidersOfType(registryType)) {
      const resolution = this.providerRegistry.resolveProvider({
        providerType: registryType,
        organizationUnitId: organizationUnitId ?? null,
      });
      if (resolution.resolved && resolution.provider) {
        return {
          providerCode: resolution.provider.providerCode.toUpperCase(),
          blockedReason: null,
        };
      }
      if (resolution.blockedByPolicy) {
        return {
          providerCode: (
            resolution.primaryProviderCode ??
            this.resolveProviderCodeForChannel(channel, runtimeConfig)
          ).toUpperCase(),
          blockedReason: resolution.reason,
        };
      }
    }
    return {
      providerCode: this.resolveProviderCodeForChannel(channel, runtimeConfig),
      blockedReason: null,
    };
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

  /**
   * Đẩy công việc gửi Email / SMS / Push Notification vào Queue chuyên biệt:
   * - Nếu là thông báo Bảo mật / OTP (`isCritical = true` hoặc `category === SECURITY`): đẩy vào `system.critical` với `priority = CRITICAL (1)`.
   * - Nếu là thông báo đơn lẻ thông thường: đẩy vào `system.notifications` với `priority = HIGH (5)`.
   * - Nếu là gửi hàng loạt theo lô (`recipients.length > 1`): đẩy vào `system.notifications` với `priority = NORMAL (50)`.
   */
  public async enqueueChannelJob(input: {
    readonly channel: string;
    readonly templateCode?: string | null;
    readonly category?: number | string;
    readonly isCritical?: boolean;
    readonly recipients: readonly {
      readonly userId?: number | null;
      readonly recipientAddress: string;
    }[];
    readonly batchSize?: number;
    readonly idempotencyKey?: string;
    readonly maxAttempts?: number;
    readonly timeoutMs?: number;
  }): Promise<MessageEnvelope<{
    readonly channel: string;
    readonly templateCode: string | null;
    readonly recipients: readonly {
      readonly userId?: number | null;
      readonly recipientAddress: string;
    }[];
    readonly batchSize: number;
  }> | null> {
    if (!this.messagePublisher) return null;
    const resolvedCategory =
      input.category !== undefined
        ? parseNotificationCategory(input.category)
        : NOTIFICATION_CATEGORY.SYSTEM;
    const isUrgent =
      Boolean(input.isCritical) ||
      resolvedCategory === NOTIFICATION_CATEGORY.SECURITY ||
      (input.templateCode ?? '').toUpperCase().includes('OTP');

    const targetQueue = isUrgent ? QUEUES.SYSTEM_CRITICAL : QUEUES.SYSTEM_NOTIFICATIONS;
    const priority = isUrgent
      ? JOB_PRIORITIES.CRITICAL
      : input.recipients.length > 1
        ? JOB_PRIORITIES.NORMAL
        : JOB_PRIORITIES.HIGH;
    const topic =
      input.recipients.length > 1
        ? 'notifications.dispatch_batch'
        : 'notifications.dispatch_single';

    return this.messagePublisher.publish(
      topic,
      {
        channel: input.channel.trim().toUpperCase(),
        templateCode: input.templateCode ?? null,
        recipients: input.recipients,
        batchSize: Math.max(1, input.batchSize ?? 50),
      },
      targetQueue,
      {
        priority,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.maxAttempts ? { attempts: input.maxAttempts } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        index: {
          channel: input.channel.trim().toUpperCase(),
          ...(input.templateCode ? { templateCode: input.templateCode } : {}),
        },
      },
    );
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

export { NotificationDeliveryService as NotificationChannelsService };
