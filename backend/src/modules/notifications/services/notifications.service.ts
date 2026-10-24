import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
  type PaginatedResult,
  SequenceRegistryService,
  defaultCodeRegistry,
  defaultFeatureFlagRegistry,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  resolvePagination,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import { type IRolesPublicService, ROLES_PUBLIC_SERVICE } from '@modules/roles/contracts/index.js';
import {
  type ISequencesPublicService,
  SEQUENCES_PUBLIC_SERVICE,
} from '@modules/settings/contracts/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import {
  type DispatchNotificationPublicInput,
  type INotificationsPublicService,
  NOTIFICATIONS_AUDIT_META,
  NOTIFICATIONS_CODE_TYPES,
  NOTIFICATIONS_FEATURE_FLAG_KEYS,
  NOTIFICATIONS_SEQUENCE_KEYS,
  NOTIFICATIONS_SETTING_KEYS,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_DISPATCH_STATUS,
  NOTIFICATION_INBOX_STATUS,
  NOTIFICATION_PRIORITY,
  getNotificationCategoryName,
  getNotificationChannelName,
  getNotificationInboxStatusName,
  parseNotificationCategory,
  parseNotificationChannel,
  parseNotificationPriority,
  parseNotificationTargetType,
} from '../contracts/index.js';
import type { NotificationRecipientEntity } from '../entities/notification-recipient.entity.js';
import type {
  NotificationChannelCode,
  NotificationChannelName,
} from '../enum/notifications.enum.js';
import { resolveNotificationRuntimeConfig } from '../helpers/notification-config.helper.js';
import {
  buildUserPreferencesViewList,
  isChannelAllowedForRecipient,
} from '../helpers/notification-preference.helper.js';
import { resolveNotificationTargetRecipients } from '../helpers/notification-target-resolver.helper.js';
import { renderNotificationTemplateContent } from '../helpers/notification-template.helper.js';
import { NotificationsMapper } from '../mappers/notifications.mapper.js';
import { NotificationPreferencesRepository } from '../repositories/notification-preferences.repository.js';
import { NotificationRecipientsRepository } from '../repositories/notification-recipients.repository.js';
import { NotificationsRepository } from '../repositories/notifications.repository.js';
import { NotificationChannelsService } from './notification-channels.service.js';
import type {
  ArchiveNotificationRequest,
  ListNotificationDispatchesQuery,
  ListUserInboxQuery,
  MarkAllNotificationsReadRequest,
  MarkNotificationReadRequest,
  SendNotificationRequest,
  UpdateNotificationPreferencesRequest,
  UpdateNotificationRuntimeConfigRequest,
} from '../requests/notifications.requests.js';
import type {
  MarkAllNotificationsReadResponse,
  NotificationArchiveMutationResponse,
  NotificationDeleteFromInboxResponse,
  NotificationDispatchDetailResponse,
  NotificationDispatchHistoryItemResponse,
  NotificationInboxItemResponse,
  NotificationPreferenceItemResponse,
  NotificationReadStateMutationResponse,
  NotificationRuntimeConfigResponse,
  NotificationUnreadSummaryResponse,
} from '../responses/notifications.response.js';
import type { ResolvedNotificationRuntimeConfig } from '../types/notifications.types.js';

@Injectable()
export class NotificationsService implements INotificationsPublicService {
  private readonly sequenceRegistry: SequenceRegistryService;

  constructor(
    private readonly notificationsRepo: NotificationsRepository,
    private readonly recipientsRepo: NotificationRecipientsRepository,
    private readonly preferencesRepo: NotificationPreferencesRepository,
    private readonly mapper: NotificationsMapper,
    @Optional() private readonly auditLogService?: AuditLogService | null,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService?: IUsersPublicService | null,
    @Optional()
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesPublicService?: IRolesPublicService | null,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService?: IOrganizationsPublicService | null,
    @Optional()
    @Inject(SequenceRegistryService)
    sequenceRegistry?: SequenceRegistryService | null,
    @Optional()
    private readonly channelsService?: NotificationChannelsService | null,
    @Optional()
    @Inject(SEQUENCES_PUBLIC_SERVICE)
    private readonly sequencesPublicService?: ISequencesPublicService | null,
  ) {
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
    this.registerCodeUsageCheckers();
  }

  private registerCodeUsageCheckers(): void {
    defaultCodeRegistry.registerUsageChecker(
      NOTIFICATIONS_CODE_TYPES.CATEGORY,
      NOTIFICATIONS_CODE_TYPES.CATEGORY,
      async () => 0,
    );
    defaultCodeRegistry.registerUsageChecker(
      NOTIFICATIONS_CODE_TYPES.PRIORITY,
      NOTIFICATIONS_CODE_TYPES.PRIORITY,
      async () => 0,
    );
    defaultCodeRegistry.registerUsageChecker(
      NOTIFICATIONS_CODE_TYPES.TARGET_TYPE,
      NOTIFICATIONS_CODE_TYPES.TARGET_TYPE,
      async () => 0,
    );
    defaultCodeRegistry.registerUsageChecker(
      NOTIFICATIONS_CODE_TYPES.CHANNEL,
      NOTIFICATIONS_CODE_TYPES.CHANNEL,
      async () => 0,
    );
    defaultCodeRegistry.registerUsageChecker(
      NOTIFICATIONS_CODE_TYPES.INBOX_STATUS,
      NOTIFICATIONS_CODE_TYPES.INBOX_STATUS,
      async () => 0,
    );
    defaultCodeRegistry.registerUsageChecker(
      NOTIFICATIONS_CODE_TYPES.DELIVERY_STATUS,
      NOTIFICATIONS_CODE_TYPES.DELIVERY_STATUS,
      async () => 0,
    );
    defaultCodeRegistry.registerUsageChecker(
      NOTIFICATIONS_CODE_TYPES.SUPPRESSION_REASON,
      NOTIFICATIONS_CODE_TYPES.SUPPRESSION_REASON,
      async () => 0,
    );
  }

  public getRuntimeConfig(
    organizationUnitId?: number | null,
    actor?: UserIdentity,
  ): ResolvedNotificationRuntimeConfig {
    return resolveNotificationRuntimeConfig(organizationUnitId, {
      userId: actor?.id ?? null,
      roles: actor?.roles ?? [],
    });
  }

  public async updateRuntimeConfig(
    input: UpdateNotificationRuntimeConfigRequest,
    actor?: UserIdentity,
  ): Promise<NotificationRuntimeConfigResponse> {
    if (input.enabled !== undefined) {
      defaultSettingRegistry.setGlobalValue(NOTIFICATIONS_SETTING_KEYS.ENABLED, input.enabled);
    }
    if (input.orgUnitTargetingEnabled !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.ORG_UNIT_TARGETING_ENABLED,
        input.orgUnitTargetingEnabled,
      );
    }
    if (input.orgUnitIncludeSubUnitsDefault !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.ORG_UNIT_INCLUDE_SUB_UNITS_DEFAULT,
        input.orgUnitIncludeSubUnitsDefault,
      );
    }
    if (input.roleTargetingEnabled !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.ROLE_TARGETING_ENABLED,
        input.roleTargetingEnabled,
      );
    }
    if (input.allowUserCustomization !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.ALLOW_USER_CUSTOMIZATION,
        input.allowUserCustomization,
      );
    }
    if (input.lockSecurityInApp !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.LOCK_SECURITY_IN_APP,
        input.lockSecurityInApp,
      );
    }
    if (input.autoReadOnOpen !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.AUTO_READ_ON_OPEN,
        input.autoReadOnOpen,
      );
    }
    if (input.retentionDays !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.RETENTION_DAYS,
        input.retentionDays,
      );
    }
    if (input.pollingIntervalSec !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.POLLING_INTERVAL_SEC,
        input.pollingIntervalSec,
      );
    }
    if (input.maxRecipientsPerBatch !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.MAX_RECIPIENTS_PER_BATCH,
        input.maxRecipientsPerBatch,
      );
    }
    if (input.maxTitleLength !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.MAX_TITLE_LENGTH,
        input.maxTitleLength,
      );
    }
    if (input.maxBodyLength !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.MAX_BODY_LENGTH,
        input.maxBodyLength,
      );
    }
    if (input.enabledChannels !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.CHANNELS_ENABLED,
        input.enabledChannels,
      );
    }
    if (input.defaultChannels !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.CHANNELS_DEFAULT,
        input.defaultChannels,
      );
    }
    if (input.emailProvider !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.EMAIL_PROVIDER,
        input.emailProvider,
      );
    }
    if (input.emailFromAddress !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.EMAIL_FROM_ADDRESS,
        input.emailFromAddress,
      );
    }
    if (input.emailFromName !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.EMAIL_FROM_NAME,
        input.emailFromName,
      );
    }
    if (input.smsProvider !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.SMS_PROVIDER,
        input.smsProvider,
      );
    }
    if (input.smsSenderId !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.SMS_SENDER_ID,
        input.smsSenderId,
      );
    }
    if (input.pushProvider !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.PUSH_PROVIDER,
        input.pushProvider,
      );
    }
    if (input.dispatchBatchSize !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.DISPATCH_BATCH_SIZE,
        input.dispatchBatchSize,
      );
    }
    if (input.dispatchRateLimitPerSec !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.DISPATCH_RATE_LIMIT_PER_SEC,
        input.dispatchRateLimitPerSec,
      );
    }
    if (input.retryEnabled !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.RETRY_ENABLED,
        input.retryEnabled,
      );
    }
    if (input.retryMaxAttempts !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.RETRY_MAX_ATTEMPTS,
        input.retryMaxAttempts,
      );
    }
    if (input.retryBaseDelaySec !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.RETRY_BASE_DELAY_SEC,
        input.retryBaseDelaySec,
      );
    }
    if (input.autoSuppressOnPermanentFailure !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.AUTO_SUPPRESS_ON_PERMANENT_FAILURE,
        input.autoSuppressOnPermanentFailure,
      );
    }
    if (input.quotaCurrency !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.QUOTA_CURRENCY,
        input.quotaCurrency,
      );
    }
    if (input.quotaHardStopOnExceed !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.QUOTA_HARD_STOP_ON_EXCEED,
        input.quotaHardStopOnExceed,
      );
    }
    if (input.smsDailyQuota !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.SMS_DAILY_QUOTA,
        input.smsDailyQuota,
      );
    }
    if (input.smsMonthlyBudget !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.SMS_MONTHLY_BUDGET,
        input.smsMonthlyBudget,
      );
    }
    if (input.smsCostPerSegment !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.SMS_COST_PER_SEGMENT,
        input.smsCostPerSegment,
      );
    }
    if (input.emailDailyQuota !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.EMAIL_DAILY_QUOTA,
        input.emailDailyQuota,
      );
    }
    if (input.emailCostPerMessage !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.EMAIL_COST_PER_MESSAGE,
        input.emailCostPerMessage,
      );
    }
    if (input.pushDailyQuota !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.PUSH_DAILY_QUOTA,
        input.pushDailyQuota,
      );
    }
    if (input.pushCostPerMessage !== undefined) {
      defaultSettingRegistry.setGlobalValue(
        NOTIFICATIONS_SETTING_KEYS.PUSH_COST_PER_MESSAGE,
        input.pushCostPerMessage,
      );
    }

    const toggleFlag = (flagKey: string, enabled?: boolean) => {
      if (enabled === undefined) return;
      const existing = defaultFeatureFlagRegistry.getDefinition(flagKey);
      if (existing) {
        defaultFeatureFlagRegistry.upsertDefinition({
          ...existing,
          isEnabled: enabled,
        });
      }
    };

    toggleFlag(NOTIFICATIONS_FEATURE_FLAG_KEYS.IN_APP_ENABLED, input.inAppFeatureEnabled);
    toggleFlag(
      NOTIFICATIONS_FEATURE_FLAG_KEYS.ORG_UNIT_BROADCAST,
      input.orgUnitBroadcastFlagEnabled,
    );
    toggleFlag(NOTIFICATIONS_FEATURE_FLAG_KEYS.ROLE_BROADCAST, input.roleBroadcastFlagEnabled);
    toggleFlag(NOTIFICATIONS_FEATURE_FLAG_KEYS.USER_PREFERENCES, input.userPreferencesFlagEnabled);
    toggleFlag(NOTIFICATIONS_FEATURE_FLAG_KEYS.EMAIL_ENABLED, input.emailFeatureEnabled);
    toggleFlag(NOTIFICATIONS_FEATURE_FLAG_KEYS.SMS_ENABLED, input.smsFeatureEnabled);
    toggleFlag(NOTIFICATIONS_FEATURE_FLAG_KEYS.PUSH_ENABLED, input.pushFeatureEnabled);

    const updated = this.getRuntimeConfig(actor?.organizationUnitIds?.[0] ?? null, actor);
    await this.recordAudit(
      actor,
      'UPDATE_NOTIFICATION_RUNTIME_CONFIG',
      NOTIFICATIONS_AUDIT_META.ENTITY_CONFIG,
      'global',
      null,
      input as unknown as Record<string, unknown>,
    );
    return updated;
  }

  public async dispatch(
    input: DispatchNotificationPublicInput | SendNotificationRequest,
    actor?: UserIdentity,
  ): Promise<NotificationDispatchDetailResponse> {
    const orgUnitId = input.organizationUnitId ?? actor?.organizationUnitIds?.[0] ?? null;
    const runtimeConfig = this.getRuntimeConfig(orgUnitId, actor);

    if (!runtimeConfig.enabled) {
      throw new ForbiddenAppException('notifications.systemDisabled');
    }

    const requestedChannels: NotificationChannelCode[] =
      input.channels && input.channels.length > 0
        ? [...new Set(input.channels.map((ch) => parseNotificationChannel(ch)))]
        : runtimeConfig.defaultChannels.map((ch) => parseNotificationChannel(ch));

    const templateCode = input.templateCode?.trim() || null;
    const templateVariables = input.templateVariables ?? null;
    const locale = input.locale?.trim() || 'vi';

    let title = (input.title ?? '').trim();
    let content = (input.content ?? '').trim();

    if (templateCode && (!title || !content) && this.channelsService) {
      const primaryChannel = requestedChannels[0] ?? 2;
      const tpl = await this.channelsService.resolveTemplateByCode(
        templateCode,
        primaryChannel,
        locale,
      );
      if (!tpl) {
        throw new NotFoundAppException('notifications.templateNotFound', { code: templateCode });
      }
      const rendered = renderNotificationTemplateContent({
        subjectTemplate: tpl.subjectTemplate,
        bodyTemplate: tpl.bodyTemplate,
        htmlTemplate: tpl.htmlTemplate,
        variables: templateVariables,
      });
      if (!title) {
        title = (rendered.renderedSubject || tpl.code).trim();
      }
      if (!content) {
        content = rendered.renderedBody.trim();
      }
    }

    if (!title) {
      throw new BadRequestAppException('notifications.titleRequired');
    }
    if (!content) {
      throw new BadRequestAppException('notifications.contentRequired');
    }
    if (title.length > runtimeConfig.maxTitleLength) {
      throw new BadRequestAppException('notifications.titleTooLong', [
        { max: runtimeConfig.maxTitleLength },
      ]);
    }
    if (content.length > runtimeConfig.maxBodyLength) {
      throw new BadRequestAppException('notifications.contentTooLong', [
        { max: runtimeConfig.maxBodyLength },
      ]);
    }

    const category =
      input.category !== undefined
        ? parseNotificationCategory(input.category)
        : NOTIFICATION_CATEGORY.SYSTEM;
    const priority =
      input.priority !== undefined
        ? parseNotificationPriority(input.priority)
        : NOTIFICATION_PRIORITY.NORMAL;
    const targetType = parseNotificationTargetType(input.targetType);

    const requestedChannelNames: NotificationChannelName[] = requestedChannels.map((c) =>
      getNotificationChannelName(c),
    );

    const resolvedTarget = await resolveNotificationTargetRecipients({
      targetType,
      userId: input.userId,
      userIds: input.userIds,
      roleIds: input.roleIds,
      roleCodes: input.roleCodes,
      organizationUnitIds: input.organizationUnitIds,
      includeSubUnits: input.includeSubUnits,
      runtimeConfig,
      usersPublicService: this.usersPublicService ?? null,
      rolesPublicService: this.rolesPublicService ?? null,
      organizationsPublicService: this.organizationsPublicService ?? null,
    });

    const recipientUserIds = resolvedTarget.recipientUserIds;
    const preferencesList =
      recipientUserIds.length > 0
        ? await this.preferencesRepo.findByUserIdsAndCategory(recipientUserIds, category)
        : [];
    const prefByUserId = new Map(preferencesList.map((p) => [Number(p.userId), p]));

    const code = await this.generateNotificationCode(orgUnitId);
    const now = new Date();
    const senderUserId =
      'senderUserId' in input && input.senderUserId !== undefined
        ? input.senderUserId
        : (actor?.id ?? null);

    let totalDelivered = 0;
    let totalSkippedByPref = 0;
    const recipientEntitiesToCreate: Partial<NotificationRecipientEntity>[] = [];

    for (const recipientUserId of recipientUserIds) {
      const userPref = prefByUserId.get(recipientUserId);
      let deliveredForUser = false;

      for (const channelCode of requestedChannels) {
        const allowed = isChannelAllowedForRecipient({
          channel: channelCode,
          category,
          preference: userPref,
          runtimeConfig,
          forceDeliver: input.forceDeliver,
          now,
        });

        if (!allowed) {
          continue;
        }

        deliveredForUser = true;
        recipientEntitiesToCreate.push({
          recipientUserId,
          organizationUnitId: orgUnitId,
          channel: channelCode,
          isRead: false,
          readAt: null,
          inboxStatus: NOTIFICATION_INBOX_STATUS.ACTIVE,
          archivedAt: null,
          recipientDeletedAt: null,
          deliveredAt: now,
        });
      }

      if (deliveredForUser) {
        totalDelivered++;
      } else {
        totalSkippedByPref++;
      }
    }

    const notificationEntity = this.notificationsRepo.repository.create({
      code,
      title,
      content,
      category,
      priority,
      targetType,
      targetIdsJson: JSON.stringify(resolvedTarget.targetPayload),
      channelsJson: JSON.stringify(requestedChannelNames),
      actionUrl: input.actionUrl?.trim() || null,
      referenceModule: input.referenceModule?.trim() || null,
      referenceType: input.referenceType?.trim() || null,
      referenceId: input.referenceId?.trim() || null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      senderUserId: senderUserId ?? null,
      organizationUnitId: orgUnitId,
      totalTargeted: recipientUserIds.length,
      totalDelivered,
      totalSkippedByPref,
      status:
        totalDelivered > 0 || recipientUserIds.length === 0
          ? NOTIFICATION_DISPATCH_STATUS.SENT
          : NOTIFICATION_DISPATCH_STATUS.PARTIAL,
      dispatchedAt: now,
    });

    const savedNotification = await this.notificationsRepo.saveEntity(notificationEntity);

    let savedRecipients: NotificationRecipientEntity[] = [];
    if (
      recipientEntitiesToCreate.length > 0 &&
      typeof this.recipientsRepo.saveEntitiesBatch === 'function'
    ) {
      savedRecipients = await this.recipientsRepo.saveEntitiesBatch(
        recipientEntitiesToCreate.map((item) => ({
          ...item,
          notificationId: Number(savedNotification.id),
        })),
      );
    } else {
      for (const item of recipientEntitiesToCreate) {
        const entity = this.recipientsRepo.repository.create({
          ...item,
          notificationId: Number(savedNotification.id),
        });
        const saved = await this.recipientsRepo.saveEntity(entity);
        savedRecipients.push(saved);
      }
    }

    if (this.channelsService && typeof this.channelsService.enqueueChannelJob === 'function') {
      const isCritical =
        priority === NOTIFICATION_PRIORITY.URGENT || category === NOTIFICATION_CATEGORY.SECURITY;
      for (const channelName of requestedChannelNames) {
        await this.channelsService
          .enqueueChannelJob({
            channel: channelName,
            templateCode: templateCode ?? savedNotification.code,
            category,
            isCritical,
            recipients: recipientUserIds.map((uid) => ({
              userId: uid,
              recipientAddress: `${channelName.toLowerCase()}:user:${uid}`,
            })),
            batchSize: runtimeConfig.dispatchBatchSize,
            idempotencyKey: input.idempotencyKey
              ? `${input.idempotencyKey}:${channelName}`
              : `dispatch:${savedNotification.code}:${channelName}`,
          })
          .catch(() => null);
      }
    }

    const externalDispatchResult = this.channelsService
      ? await this.channelsService.dispatchExternalChannelDeliveries({
          notification: savedNotification,
          savedRecipients,
          recipientUserIds,
          templateCode,
          templateVariables,
          locale,
          callerIdempotencyKey: input.idempotencyKey ?? null,
          metadata: input.metadata ?? null,
          runtimeConfig,
        })
      : undefined;

    await this.recordAudit(
      actor,
      'DISPATCH_NOTIFICATION',
      NOTIFICATIONS_AUDIT_META.ENTITY_NOTIFICATION,
      String(savedNotification.id),
      null,
      {
        code: savedNotification.code,
        category,
        priority,
        targetType,
        templateCode,
        totalTargeted: recipientUserIds.length,
        totalDelivered,
        totalSkippedByPref,
      },
    );

    return this.mapper.toDispatchDetailView(
      savedNotification,
      savedRecipients,
      {
        notificationId: Number(savedNotification.id),
        readCount: 0,
        archivedCount: 0,
        deletedFromInboxCount: 0,
      },
      locale,
      externalDispatchResult?.deliveries,
      externalDispatchResult?.summary,
    );
  }

  public async listUserInbox(
    userId: number,
    query: ListUserInboxQuery,
    locale = 'vi',
  ): Promise<PaginatedResult<NotificationInboxItemResponse>> {
    const pagination = resolvePagination(query, {
      settingPrefix: 'notifications.pagination',
    });
    const paginatedRecipients = await this.recipientsRepo.findPaginatedUserInbox({
      ...pagination,
      recipientUserId: userId,
      inboxStatus: query.inboxStatus ?? NOTIFICATION_INBOX_STATUS.ACTIVE,
      isRead: query.isRead,
      category: query.category,
      priority: query.priority,
      search: query.search,
    });

    const notificationIds = paginatedRecipients.items.map((r) => Number(r.notificationId));
    const notifications = await this.notificationsRepo.findByIds(notificationIds);
    const notificationMap = new Map(notifications.map((n) => [Number(n.id), n]));

    const items: NotificationInboxItemResponse[] = [];
    for (const rec of paginatedRecipients.items) {
      const notif = notificationMap.get(Number(rec.notificationId));
      if (!notif) continue;
      items.push(this.mapper.toInboxItemView(rec, notif, locale));
    }

    return createPaginatedResult(
      items,
      paginatedRecipients.total,
      paginatedRecipients.page,
      paginatedRecipients.limit,
    );
  }

  public async getInboxItemDetail(
    userId: number,
    entryId: number,
    options?: { autoMarkRead?: boolean; locale?: string },
  ): Promise<NotificationInboxItemResponse> {
    const entry = await this.recipientsRepo.findInboxEntryForUser(entryId, userId);
    if (!entry || Number(entry.inboxStatus) === NOTIFICATION_INBOX_STATUS.DELETED) {
      throw new NotFoundAppException('notifications.inboxItemNotFound', { id: entryId });
    }

    const notifications = await this.notificationsRepo.findByIds([Number(entry.notificationId)]);
    const notification = notifications[0];
    if (!notification) {
      throw new NotFoundAppException('notifications.inboxItemNotFound', { id: entryId });
    }

    const runtimeConfig = this.getRuntimeConfig(entry.organizationUnitId ?? null);
    const shouldAutoRead =
      options?.autoMarkRead !== undefined ? options.autoMarkRead : runtimeConfig.autoReadOnOpen;

    if (shouldAutoRead && !entry.isRead) {
      entry.isRead = true;
      entry.readAt = new Date();
      await this.recipientsRepo.saveEntity(entry);
    }

    return this.mapper.toInboxItemView(entry, notification, options?.locale ?? 'vi');
  }

  public async getUnreadSummary(userId: number): Promise<NotificationUnreadSummaryResponse> {
    const summary = await this.recipientsRepo.getUnreadSummaryForUser(userId);
    const byCategory: Record<string, number> = {
      SYSTEM: 0,
      WORK: 0,
      SECURITY: 0,
      ANNOUNCEMENT: 0,
    };

    for (const [catCode, count] of summary.byCategory.entries()) {
      const catName = getNotificationCategoryName(catCode);
      byCategory[catName] = (byCategory[catName] ?? 0) + count;
    }

    return {
      unreadCount: summary.unreadCount,
      totalActiveCount: summary.totalActiveCount,
      totalArchivedCount: summary.totalArchivedCount,
      byCategory,
    };
  }

  public async setReadState(
    userId: number,
    entryId: number,
    input: MarkNotificationReadRequest,
  ): Promise<NotificationReadStateMutationResponse> {
    const entry = await this.recipientsRepo.findInboxEntryForUser(entryId, userId);
    if (!entry || Number(entry.inboxStatus) === NOTIFICATION_INBOX_STATUS.DELETED) {
      throw new NotFoundAppException('notifications.inboxItemNotFound', { id: entryId });
    }

    entry.isRead = Boolean(input.isRead);
    entry.readAt = entry.isRead ? new Date() : null;
    const saved = await this.recipientsRepo.saveEntity(entry);
    const summary = await this.getUnreadSummary(userId);

    return {
      id: Number(saved.id),
      notificationId: Number(saved.notificationId),
      isRead: Boolean(saved.isRead),
      readAt: saved.readAt ? saved.readAt.toISOString() : null,
      unreadCount: summary.unreadCount,
    };
  }

  public async markAllAsRead(
    userId: number,
    input?: MarkAllNotificationsReadRequest,
  ): Promise<MarkAllNotificationsReadResponse> {
    const updatedCount = await this.recipientsRepo.markAllAsReadForUser(userId, input?.category);
    const summary = await this.getUnreadSummary(userId);

    return {
      updatedCount,
      unreadCount: summary.unreadCount,
    };
  }

  public async setArchiveState(
    userId: number,
    entryId: number,
    input: ArchiveNotificationRequest,
  ): Promise<NotificationArchiveMutationResponse> {
    const entry = await this.recipientsRepo.findInboxEntryForUser(entryId, userId);
    if (!entry || Number(entry.inboxStatus) === NOTIFICATION_INBOX_STATUS.DELETED) {
      throw new NotFoundAppException('notifications.inboxItemNotFound', { id: entryId });
    }

    const targetStatus = input.archived
      ? NOTIFICATION_INBOX_STATUS.ARCHIVED
      : NOTIFICATION_INBOX_STATUS.ACTIVE;
    entry.inboxStatus = targetStatus;
    entry.archivedAt = input.archived ? new Date() : null;
    const saved = await this.recipientsRepo.saveEntity(entry);
    const summary = await this.getUnreadSummary(userId);

    return {
      id: Number(saved.id),
      notificationId: Number(saved.notificationId),
      inboxStatus: targetStatus,
      inboxStatusName: getNotificationInboxStatusName(targetStatus),
      archivedAt: saved.archivedAt ? saved.archivedAt.toISOString() : null,
      unreadCount: summary.unreadCount,
    };
  }

  public async deleteFromInbox(
    userId: number,
    entryId: number,
  ): Promise<NotificationDeleteFromInboxResponse> {
    const entry = await this.recipientsRepo.findInboxEntryForUser(entryId, userId);
    if (!entry || Number(entry.inboxStatus) === NOTIFICATION_INBOX_STATUS.DELETED) {
      throw new NotFoundAppException('notifications.inboxItemNotFound', { id: entryId });
    }

    entry.inboxStatus = NOTIFICATION_INBOX_STATUS.DELETED;
    entry.recipientDeletedAt = new Date();
    const saved = await this.recipientsRepo.saveEntity(entry);
    const summary = await this.getUnreadSummary(userId);

    return {
      deleted: true,
      id: Number(saved.id),
      notificationId: Number(saved.notificationId),
      unreadCount: summary.unreadCount,
      dispatchHistoryPreserved: true,
    };
  }

  public async getUserPreferences(
    userId: number,
    organizationUnitId?: number | null,
    locale = 'vi',
  ): Promise<NotificationPreferenceItemResponse[]> {
    const runtimeConfig = this.getRuntimeConfig(organizationUnitId);
    const storedPreferences = await this.preferencesRepo.findByUserId(userId);
    return buildUserPreferencesViewList({
      storedPreferences,
      runtimeConfig,
      locale,
    });
  }

  public async updateUserPreferences(
    userId: number,
    input: UpdateNotificationPreferencesRequest,
    actor?: UserIdentity,
    locale = 'vi',
  ): Promise<NotificationPreferenceItemResponse[]> {
    const orgUnitId = actor?.organizationUnitIds?.[0] ?? null;
    const runtimeConfig = this.getRuntimeConfig(orgUnitId, actor);

    if (!runtimeConfig.allowUserCustomization || !runtimeConfig.userPreferencesFlagEnabled) {
      throw new ForbiddenAppException('notifications.preferencesCustomizationDisabled');
    }

    const currentList = await this.getUserPreferences(userId, orgUnitId, locale);
    const currentByCat = new Map(currentList.map((item) => [item.category, item]));

    for (const item of input.preferences) {
      const categoryCode = parseNotificationCategory(item.category);
      const categoryName = getNotificationCategoryName(categoryCode);
      const existingView = currentByCat.get(categoryCode);

      const isSecurityCategory =
        categoryCode === NOTIFICATION_CATEGORY.SECURITY || categoryName === 'SECURITY';
      const forceInAppTrue = isSecurityCategory && runtimeConfig.lockSecurityInApp;

      const inAppEnabled = forceInAppTrue
        ? true
        : (item.inAppEnabled ?? existingView?.inAppEnabled ?? true);
      const emailEnabled = item.emailEnabled ?? existingView?.emailEnabled ?? true;
      const smsEnabled = item.smsEnabled ?? existingView?.smsEnabled ?? false;
      const pushEnabled = item.pushEnabled ?? existingView?.pushEnabled ?? true;
      const mutedUntil =
        item.mutedUntil !== undefined
          ? item.mutedUntil
            ? new Date(item.mutedUntil)
            : null
          : existingView?.mutedUntil
            ? new Date(existingView.mutedUntil)
            : null;

      await this.preferencesRepo.upsertPreference({
        userId,
        category: categoryCode,
        inAppEnabled,
        emailEnabled,
        smsEnabled,
        pushEnabled,
        mutedUntil,
      });
    }

    await this.recordAudit(
      actor,
      'UPDATE_NOTIFICATION_PREFERENCES',
      NOTIFICATIONS_AUDIT_META.ENTITY_PREFERENCE,
      String(userId),
      null,
      { userId, updatedCount: input.preferences.length },
    );

    return this.getUserPreferences(userId, orgUnitId, locale);
  }

  public async listDispatchHistory(
    query: ListNotificationDispatchesQuery,
    locale = 'vi',
  ): Promise<PaginatedResult<NotificationDispatchHistoryItemResponse>> {
    const pagination = resolvePagination(query, {
      settingPrefix: 'notifications.pagination',
    });
    const paginated = await this.notificationsRepo.findPaginatedDispatches({
      ...pagination,
      search: query.search,
      category: query.category,
      priority: query.priority,
      targetType: query.targetType,
      organizationUnitId: query.organizationUnitId,
    });

    const notificationIds = paginated.items.map((n) => Number(n.id));
    const statsMap = await this.recipientsRepo.aggregateStatsByNotificationIds(notificationIds);

    const items = paginated.items.map((n) =>
      this.mapper.toDispatchHistoryItemView(n, statsMap.get(Number(n.id)), locale),
    );

    return createPaginatedResult(items, paginated.total, paginated.page, paginated.limit);
  }

  public async getDispatchDetail(
    notificationId: number,
    locale = 'vi',
  ): Promise<NotificationDispatchDetailResponse> {
    const notifications = await this.notificationsRepo.findByIds([notificationId]);
    const notification = notifications[0];
    if (!notification) {
      throw new NotFoundAppException('notifications.dispatchNotFound', { id: notificationId });
    }

    const recipients = await this.recipientsRepo.findByNotificationId(notificationId);
    const statsMap = await this.recipientsRepo.aggregateStatsByNotificationIds([notificationId]);
    const channelDeliveries = this.channelsService
      ? await this.channelsService.listDeliveriesForNotification(notificationId, locale)
      : undefined;

    return this.mapper.toDispatchDetailView(
      notification,
      recipients,
      statsMap.get(notificationId),
      locale,
      channelDeliveries,
    );
  }

  private async generateNotificationCode(organizationUnitId?: number | null): Promise<string> {
    const generated = this.sequencesPublicService
      ? await this.sequencesPublicService.nextCode(NOTIFICATIONS_SEQUENCE_KEYS.NOTIFICATION_CODE, {
          organizationUnitId: organizationUnitId ?? null,
        })
      : await this.sequenceRegistry.nextCode(NOTIFICATIONS_SEQUENCE_KEYS.NOTIFICATION_CODE, {
          organizationUnitId: organizationUnitId ?? null,
        });
    return generated.code;
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
        feature: 'in_app_notifications',
        action,
        resourceType,
        resourceId,
        beforeData,
        afterData,
      })
      .catch(() => undefined);
  }
}
