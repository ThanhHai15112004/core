import {
  SequenceRegistryService,
  defaultCodeRegistry,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import type {
  IOrganizationsPublicService,
  OrganizationUnitSummary,
} from '@modules/organizations/contracts/index.js';
import type { IRolesPublicService, RoleSummary } from '@modules/roles/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import {
  DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES,
  EmailChannelProviderAdapter,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_ERROR_TYPE,
  NOTIFICATION_INBOX_STATUS,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_SUPPRESSION_REASON,
  NOTIFICATION_TARGET_TYPE,
  NotificationChannelAdapterRegistry,
  NotificationChannelsService,
  NotificationsController,
  NotificationsMapper,
  NotificationsService,
  PushChannelProviderAdapter,
  SmsChannelProviderAdapter,
  calculateSmsSegments,
} from '@modules/notifications/index.js';
import type { NotificationDeliveryEntity } from '@modules/notifications/entities/notification-delivery.entity.js';
import type { NotificationPreferenceEntity } from '@modules/notifications/entities/notification-preference.entity.js';
import type { NotificationPushSubscriptionEntity } from '@modules/notifications/entities/notification-push-subscription.entity.js';
import type { NotificationQuotaUsageEntity } from '@modules/notifications/entities/notification-quota-usage.entity.js';
import type { NotificationRecipientEntity } from '@modules/notifications/entities/notification-recipient.entity.js';
import type { NotificationSuppressionEntity } from '@modules/notifications/entities/notification-suppression.entity.js';
import type { NotificationTemplateEntity } from '@modules/notifications/entities/notification-template.entity.js';
import type { NotificationEntity } from '@modules/notifications/entities/notification.entity.js';
import type {
  NotificationChannelsRepository,
  NotificationDeliveryFilterOptions,
  NotificationSuppressionFilterOptions,
  NotificationTemplateFilterOptions,
} from '@modules/notifications/repositories/notification-channels.repository.js';
import type { NotificationPreferencesRepository } from '@modules/notifications/repositories/notification-preferences.repository.js';
import type {
  NotificationDispatchAggregateStats,
  NotificationInboxFilterOptions,
  NotificationRecipientsRepository,
} from '@modules/notifications/repositories/notification-recipients.repository.js';
import type {
  NotificationDispatchFilterOptions,
  NotificationsRepository,
} from '@modules/notifications/repositories/notifications.repository.js';

function createInMemoryNotificationsHarness() {
  defaultCodeRegistry.seedDefaults();
  defaultSettingRegistry.bootstrapFromManifests();
  defaultFeatureFlagRegistry.bootstrapFromManifests();
  const sequenceRegistry = new SequenceRegistryService();
  sequenceRegistry.registerManifestSequences();

  const notificationsStore: NotificationEntity[] = [];
  const recipientsStore: NotificationRecipientEntity[] = [];
  const preferencesStore: NotificationPreferenceEntity[] = [];
  const templatesStore: NotificationTemplateEntity[] = DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES.map(
    (t, idx) =>
      ({
        id: idx + 1,
        code: t.code,
        name: t.name,
        channel: t.channel,
        category: t.category,
        locale: t.locale,
        subjectTemplate: t.subjectTemplate,
        bodyTemplate: t.bodyTemplate,
        htmlTemplate: t.htmlTemplate,
        variablesJson: JSON.stringify(t.variables),
        isActive: true,
        isSystem: t.isSystem,
        organizationUnitId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }) as NotificationTemplateEntity,
  );
  const deliveriesStore: NotificationDeliveryEntity[] = [];
  const suppressionsStore: NotificationSuppressionEntity[] = [];
  const pushSubsStore: NotificationPushSubscriptionEntity[] = [];
  const quotaUsagesStore: NotificationQuotaUsageEntity[] = [];

  let nextNotifId = 1;
  let nextRecId = 1;
  let nextPrefId = 1;
  let nextTplId = templatesStore.length + 1;
  let nextDelivId = 1;
  let nextSuppId = 1;
  let nextPushSubId = 1;
  let nextQuotaId = 1;

  const notificationsRepo = {
    repository: {
      create: (data: Partial<NotificationEntity>): NotificationEntity =>
        ({
          id: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          ...data,
        }) as NotificationEntity,
    },
    saveEntity: async (entity: NotificationEntity): Promise<NotificationEntity> => {
      if (!entity.id) {
        entity.id = nextNotifId++;
        notificationsStore.push(entity);
      } else {
        const idx = notificationsStore.findIndex((n) => n.id === entity.id);
        if (idx >= 0) notificationsStore[idx] = entity;
      }
      return entity;
    },
    findByIds: async (ids: readonly number[]): Promise<NotificationEntity[]> =>
      notificationsStore.filter((n) => ids.includes(Number(n.id)) && !n.deletedAt),
    findPaginatedDispatches: async (options: NotificationDispatchFilterOptions) => {
      let filtered = notificationsStore.filter((n) => !n.deletedAt);
      if (options.category !== undefined) {
        filtered = filtered.filter((n) => Number(n.category) === options.category);
      }
      if (options.targetType !== undefined) {
        filtered = filtered.filter((n) => Number(n.targetType) === options.targetType);
      }
      filtered.sort((a, b) => Number(b.id) - Number(a.id));
      const page = options.page ?? 1;
      const limit = options.limit ?? 20;
      return {
        items: filtered,
        total: filtered.length,
        page,
        limit,
        offset: (page - 1) * limit,
        skip: (page - 1) * limit,
        take: limit,
        countMode: 'exact' as const,
      };
    },
  } as unknown as NotificationsRepository;

  const recipientsRepo = {
    repository: {
      create: (data: Partial<NotificationRecipientEntity>): NotificationRecipientEntity =>
        ({
          id: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          ...data,
        }) as NotificationRecipientEntity,
    },
    saveEntity: async (
      entity: NotificationRecipientEntity,
    ): Promise<NotificationRecipientEntity> => {
      if (!entity.id) {
        entity.id = nextRecId++;
        recipientsStore.push(entity);
      } else {
        const idx = recipientsStore.findIndex((r) => r.id === entity.id);
        if (idx >= 0) recipientsStore[idx] = entity;
      }
      return entity;
    },
    findInboxEntryForUser: async (
      entryId: number,
      recipientUserId: number,
    ): Promise<NotificationRecipientEntity | null> =>
      recipientsStore.find(
        (r) =>
          Number(r.id) === entryId && Number(r.recipientUserId) === recipientUserId && !r.deletedAt,
      ) ?? null,
    findByNotificationId: async (notificationId: number): Promise<NotificationRecipientEntity[]> =>
      recipientsStore.filter((r) => Number(r.notificationId) === notificationId && !r.deletedAt),
    findPaginatedUserInbox: async (options: NotificationInboxFilterOptions) => {
      const targetStatus = options.inboxStatus ?? NOTIFICATION_INBOX_STATUS.ACTIVE;
      let filtered = recipientsStore.filter(
        (r) =>
          !r.deletedAt &&
          Number(r.recipientUserId) === options.recipientUserId &&
          Number(r.inboxStatus) === targetStatus,
      );
      if (options.isRead !== undefined) {
        filtered = filtered.filter((r) => Boolean(r.isRead) === options.isRead);
      }
      if (options.category !== undefined) {
        filtered = filtered.filter((r) => {
          const notif = notificationsStore.find((n) => Number(n.id) === Number(r.notificationId));
          return notif && Number(notif.category) === options.category;
        });
      }
      filtered.sort((a, b) => Number(b.id) - Number(a.id));
      const page = options.page ?? 1;
      const limit = options.limit ?? 20;
      return {
        items: filtered,
        total: filtered.length,
        page,
        limit,
        offset: (page - 1) * limit,
        skip: (page - 1) * limit,
        take: limit,
        countMode: 'exact' as const,
      };
    },
    getUnreadSummaryForUser: async (recipientUserId: number) => {
      const userRecs = recipientsStore.filter(
        (r) => !r.deletedAt && Number(r.recipientUserId) === recipientUserId,
      );
      let unreadCount = 0;
      let totalActiveCount = 0;
      let totalArchivedCount = 0;
      const byCategory = new Map<number, number>();

      for (const r of userRecs) {
        const notif = notificationsStore.find((n) => Number(n.id) === Number(r.notificationId));
        if (!notif) continue;
        if (Number(r.inboxStatus) === NOTIFICATION_INBOX_STATUS.ACTIVE) {
          totalActiveCount++;
          if (!r.isRead) {
            unreadCount++;
            const cat = Number(notif.category);
            byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
          }
        } else if (Number(r.inboxStatus) === NOTIFICATION_INBOX_STATUS.ARCHIVED) {
          totalArchivedCount++;
        }
      }
      return { unreadCount, totalActiveCount, totalArchivedCount, byCategory };
    },
    markAllAsReadForUser: async (recipientUserId: number, category?: number): Promise<number> => {
      let count = 0;
      const now = new Date();
      for (const r of recipientsStore) {
        if (
          !r.deletedAt &&
          Number(r.recipientUserId) === recipientUserId &&
          Number(r.inboxStatus) === NOTIFICATION_INBOX_STATUS.ACTIVE &&
          !r.isRead
        ) {
          const notif = notificationsStore.find((n) => Number(n.id) === Number(r.notificationId));
          if (category !== undefined && Number(notif?.category) !== category) {
            continue;
          }
          r.isRead = true;
          r.readAt = now;
          count++;
        }
      }
      return count;
    },
    aggregateStatsByNotificationIds: async (notificationIds: readonly number[]) => {
      const map = new Map<number, NotificationDispatchAggregateStats>();
      for (const id of notificationIds) {
        const recs = recipientsStore.filter((r) => Number(r.notificationId) === Number(id));
        map.set(Number(id), {
          notificationId: Number(id),
          readCount: recs.filter((r) => r.isRead).length,
          archivedCount: recs.filter(
            (r) => Number(r.inboxStatus) === NOTIFICATION_INBOX_STATUS.ARCHIVED,
          ).length,
          deletedFromInboxCount: recs.filter(
            (r) => Number(r.inboxStatus) === NOTIFICATION_INBOX_STATUS.DELETED,
          ).length,
        });
      }
      return map;
    },
  } as unknown as NotificationRecipientsRepository;

  const preferencesRepo = {
    findByUserId: async (userId: number): Promise<NotificationPreferenceEntity[]> =>
      preferencesStore.filter((p) => Number(p.userId) === userId && !p.deletedAt),
    findByUserIdsAndCategory: async (
      userIds: readonly number[],
      category: number,
    ): Promise<NotificationPreferenceEntity[]> =>
      preferencesStore.filter(
        (p) =>
          userIds.includes(Number(p.userId)) && Number(p.category) === category && !p.deletedAt,
      ),
    upsertPreference: async (input: {
      userId: number;
      category: number;
      inAppEnabled: boolean;
      emailEnabled: boolean;
      smsEnabled: boolean;
      pushEnabled: boolean;
      mutedUntil?: Date | null;
    }): Promise<NotificationPreferenceEntity> => {
      const existing = preferencesStore.find(
        (p) => Number(p.userId) === input.userId && Number(p.category) === input.category,
      );
      if (existing) {
        existing.inAppEnabled = input.inAppEnabled;
        existing.emailEnabled = input.emailEnabled;
        existing.smsEnabled = input.smsEnabled;
        existing.pushEnabled = input.pushEnabled;
        existing.mutedUntil = input.mutedUntil ?? null;
        existing.updatedAt = new Date();
        return existing;
      }
      const created = {
        id: nextPrefId++,
        userId: input.userId,
        category: input.category,
        inAppEnabled: input.inAppEnabled,
        emailEnabled: input.emailEnabled,
        smsEnabled: input.smsEnabled,
        pushEnabled: input.pushEnabled,
        mutedUntil: input.mutedUntil ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as NotificationPreferenceEntity;
      preferencesStore.push(created);
      return created;
    },
  } as unknown as NotificationPreferencesRepository;

  const usersPublicService: IUsersPublicService = {
    findAuthUserByIdentifier: async () => null,
    findAuthUserById: async (id) =>
      id >= 1 && id <= 10
        ? ({
            id,
            username: `user_${id}`,
            email: `user_${id}@example.com`,
            firstName: 'User',
            lastName: `#${id}`,
            fullName: `User #${id}`,
            phone: null,
            status: 1,
            statusName: 'ACTIVE',
            lockedUntil: null,
            mfaEnabled: false,
            primaryOrganizationUnitId: 1,
            organizationUnitIds: [1],
            roles: ['admin'],
            permissions: ['notifications.read', 'notifications.send', 'notifications.manage'],
          } as never)
        : null,
    registerSelfUser: async () => ({}) as never,
    markEmailVerified: async () => undefined,
    markPhoneVerified: async () => undefined,
    recordLoginSuccess: async () => undefined,
    recordLoginFailure: async () => ({ failedAttempts: 0, locked: false, lockedUntil: null }),
    autoUnlockExpiredLock: async () => undefined,
    updatePasswordHash: async () => undefined,
    setMfaEnabled: async () => undefined,
    findActiveUserIdsByIds: async (ids) => ids.filter((id) => id >= 1 && id <= 10),
    findActiveUserIdsByRoleIds: async (roleIds) => {
      const set = new Set<number>();
      if (roleIds.includes(1)) {
        set.add(1);
        set.add(2);
      }
      if (roleIds.includes(2)) {
        set.add(2);
        set.add(3);
      }
      return [...set];
    },
    findActiveUserIdsByOrganizationUnitIds: async (unitIds) => {
      const set = new Set<number>();
      if (unitIds.includes(1)) {
        set.add(1);
        set.add(2);
      }
      if (unitIds.includes(2)) {
        set.add(3);
        set.add(4);
      }
      return [...set];
    },
    findUserContactsByIds: async (userIds) =>
      userIds.map((uid) => ({
        id: uid,
        username: `user_${uid}`,
        email: `user_${uid}@example.com`,
        phone: `090100000${uid}`,
        fullName: `Người dùng #${uid}`,
        preferredLocale: 'vi',
        preferredTimezone: 'Asia/Ho_Chi_Minh',
        primaryOrganizationUnitId: 1,
      })),
  };

  const rolesPublicService: IRolesPublicService = {
    findByIds: async (ids) =>
      ids.map(
        (id) =>
          ({
            id,
            code: id === 1 ? 'SUPER_ADMIN' : 'MANAGER',
            name: id === 1 ? 'Super Admin' : 'Manager',
            isSystem: true,
            dataScope: 1,
            dataScopeName: 'ALL',
            status: 1,
            statusName: 'ACTIVE',
            permissionIds: [],
            permissions: [],
          }) satisfies RoleSummary,
      ),
    findByCodes: async (codes) =>
      codes.map((code, idx) => ({
        id: code === 'SUPER_ADMIN' ? 1 : idx + 2,
        code,
        name: code,
        isSystem: true,
        dataScope: 1,
        dataScopeName: 'ALL',
        status: 1,
        statusName: 'ACTIVE',
        permissionIds: [],
        permissions: [],
      })),
    resolvePermissionsByRoleIds: async () => [],
    ensureActiveRolesExist: async (ids) => rolesPublicService.findByIds(ids),
  };

  const organizationsPublicService: IOrganizationsPublicService = {
    findByIds: async (ids) =>
      ids.map(
        (id) =>
          ({
            id,
            code: `ORG_${id}`,
            name: `Đơn vị #${id}`,
            type: 1,
            typeName: 'HEADQUARTERS',
            parentId: null,
            status: 1,
            statusName: 'ACTIVE',
          }) satisfies OrganizationUnitSummary,
      ),
    findByCodes: async () => [],
    ensureActiveUnitsExist: async (ids) => organizationsPublicService.findByIds(ids),
    resolveDescendantUnitIds: async (rootIds) => (rootIds.includes(1) ? [1, 2] : [...rootIds]),
  };

  const channelsRepo = {
    repository: {
      create: (data: Partial<NotificationDeliveryEntity>): NotificationDeliveryEntity =>
        ({
          id: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          ...data,
        }) as NotificationDeliveryEntity,
    },
    saveEntity: async (entity: NotificationDeliveryEntity): Promise<NotificationDeliveryEntity> => {
      if (!entity.id) {
        entity.id = nextDelivId++;
        deliveriesStore.push(entity);
      } else {
        const idx = deliveriesStore.findIndex((d) => d.id === entity.id);
        if (idx >= 0) deliveriesStore[idx] = entity;
      }
      return entity;
    },
    findTemplateById: async (id: number) =>
      templatesStore.find((t) => Number(t.id) === id && !t.deletedAt) ?? null,
    findTemplateByCodeChannelLocale: async (code: string, channel: number, locale = 'vi') => {
      const cleanCode = code.trim().toUpperCase();
      const cleanLocale = locale.trim().toLowerCase() || 'vi';
      return (
        templatesStore.find(
          (t) =>
            t.code === cleanCode &&
            Number(t.channel) === channel &&
            t.locale === cleanLocale &&
            t.isActive &&
            !t.deletedAt,
        ) ??
        templatesStore.find(
          (t) =>
            t.code === cleanCode && Number(t.channel) === channel && t.isActive && !t.deletedAt,
        ) ??
        templatesStore.find((t) => t.code === cleanCode && t.isActive && !t.deletedAt) ??
        null
      );
    },
    findPaginatedTemplates: async (options: NotificationTemplateFilterOptions) => {
      let filtered = templatesStore.filter((t) => !t.deletedAt);
      if (options.channel !== undefined) {
        filtered = filtered.filter((t) => Number(t.channel) === options.channel);
      }
      const page = options.page ?? 1;
      const limit = options.limit ?? 20;
      return {
        items: filtered,
        total: filtered.length,
        page,
        limit,
        offset: 0,
        skip: 0,
        take: limit,
        countMode: 'exact' as const,
      };
    },
    upsertTemplate: async (
      data: Partial<NotificationTemplateEntity> & {
        code: string;
        channel: number;
        locale: string;
      },
    ) => {
      const existing = templatesStore.find(
        (t) =>
          t.code === data.code && Number(t.channel) === data.channel && t.locale === data.locale,
      );
      if (existing) {
        Object.assign(existing, data, { updatedAt: new Date() });
        return existing;
      }
      const created = {
        id: nextTplId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        isSystem: false,
        isActive: true,
        ...data,
      } as NotificationTemplateEntity;
      templatesStore.push(created);
      return created;
    },
    deleteTemplateById: async (id: number) => {
      const idx = templatesStore.findIndex((t) => Number(t.id) === id);
      if (idx >= 0) templatesStore.splice(idx, 1);
    },
    findDeliveryById: async (id: number) =>
      deliveriesStore.find((d) => Number(d.id) === id && !d.deletedAt) ?? null,
    findDeliveryByIdempotencyKey: async (idempotencyKey: string) =>
      deliveriesStore.find((d) => d.idempotencyKey === idempotencyKey && !d.deletedAt) ?? null,
    findDeliveriesByNotificationId: async (notificationId: number) =>
      deliveriesStore.filter((d) => Number(d.notificationId) === notificationId && !d.deletedAt),
    findDueRetryDeliveries: async (now: Date, limit = 100) =>
      deliveriesStore
        .filter(
          (d) =>
            !d.deletedAt &&
            Number(d.status) === NOTIFICATION_DELIVERY_STATUS.QUEUED &&
            d.nextRetryAt &&
            d.nextRetryAt.getTime() <= now.getTime(),
        )
        .slice(0, limit),
    findPaginatedDeliveries: async (options: NotificationDeliveryFilterOptions) => {
      let filtered = deliveriesStore.filter((d) => !d.deletedAt);
      if (options.channel !== undefined) {
        filtered = filtered.filter((d) => Number(d.channel) === options.channel);
      }
      if (options.status !== undefined) {
        filtered = filtered.filter((d) => Number(d.status) === options.status);
      }
      const page = options.page ?? 1;
      const limit = options.limit ?? 20;
      return {
        items: filtered,
        total: filtered.length,
        page,
        limit,
        offset: 0,
        skip: 0,
        take: limit,
        countMode: 'exact' as const,
      };
    },
    findActiveSuppressionsForDestinations: async (
      channel: number,
      destinations: readonly string[],
    ) => {
      const normSet = new Set(destinations.map((d) => d.trim().toLowerCase()).filter(Boolean));
      const blocked = new Set<string>();
      for (const s of suppressionsStore) {
        if (
          Number(s.channel) === channel &&
          s.isActive &&
          normSet.has(s.destination.trim().toLowerCase())
        ) {
          blocked.add(s.destination.trim().toLowerCase());
        }
      }
      return blocked;
    },
    upsertSuppression: async (params: {
      channel: number;
      destination: string;
      reason: number;
      providerCode?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      sourceNotificationId?: number | null;
      expiresAt?: Date | null;
    }) => {
      const cleanDest =
        params.channel === NOTIFICATION_CHANNEL.PUSH
          ? params.destination.trim()
          : params.destination.trim().toLowerCase();
      const existing = suppressionsStore.find(
        (s) =>
          Number(s.channel) === params.channel &&
          s.destination.toLowerCase() === cleanDest.toLowerCase(),
      );
      if (existing) {
        existing.reason = params.reason;
        existing.isActive = true;
        existing.errorCode = params.errorCode ?? null;
        existing.errorMessage = params.errorMessage ?? null;
        existing.suppressedAt = new Date();
        return existing;
      }
      const created = {
        id: nextSuppId++,
        channel: params.channel,
        destination: cleanDest,
        reason: params.reason,
        providerCode: params.providerCode ?? null,
        errorCode: params.errorCode ?? null,
        errorMessage: params.errorMessage ?? null,
        sourceNotificationId: params.sourceNotificationId ?? null,
        isActive: true,
        suppressedAt: new Date(),
        expiresAt: params.expiresAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as NotificationSuppressionEntity;
      suppressionsStore.push(created);
      return created;
    },
    removeSuppressionById: async (id: number) => {
      const existing = suppressionsStore.find((s) => Number(s.id) === id);
      if (!existing) return false;
      existing.isActive = false;
      return true;
    },
    findPaginatedSuppressions: async (options: NotificationSuppressionFilterOptions) => {
      let filtered = suppressionsStore.filter((s) => !s.deletedAt);
      if (options.channel !== undefined) {
        filtered = filtered.filter((s) => Number(s.channel) === options.channel);
      }
      if (options.isActive !== undefined) {
        filtered = filtered.filter((s) => Boolean(s.isActive) === options.isActive);
      }
      const page = options.page ?? 1;
      const limit = options.limit ?? 20;
      return {
        items: filtered,
        total: filtered.length,
        page,
        limit,
        offset: 0,
        skip: 0,
        take: limit,
        countMode: 'exact' as const,
      };
    },
    findActivePushSubscriptionsByUserIds: async (userIds: readonly number[]) =>
      pushSubsStore.filter((s) => userIds.includes(Number(s.userId)) && s.isActive),
    findUserPushSubscriptions: async (userId: number) =>
      pushSubsStore.filter((s) => Number(s.userId) === userId),
    upsertPushSubscription: async (params: {
      userId: number;
      platform: number;
      deviceToken: string;
      endpoint?: string | null;
      p256dhKey?: string | null;
      authKey?: string | null;
      deviceName?: string | null;
    }) => {
      const existing = pushSubsStore.find(
        (s) => Number(s.userId) === params.userId && s.deviceToken === params.deviceToken,
      );
      if (existing) {
        existing.isActive = true;
        existing.invalidatedAt = null;
        existing.failureReason = null;
        return existing;
      }
      const created = {
        id: nextPushSubId++,
        userId: params.userId,
        platform: params.platform,
        deviceToken: params.deviceToken,
        endpoint: params.endpoint ?? null,
        p256dhKey: params.p256dhKey ?? null,
        authKey: params.authKey ?? null,
        deviceName: params.deviceName ?? null,
        isActive: true,
        invalidatedAt: null,
        failureReason: null,
        lastUsedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as NotificationPushSubscriptionEntity;
      pushSubsStore.push(created);
      return created;
    },
    deactivatePushToken: async (deviceToken: string, reason: string) => {
      for (const s of pushSubsStore) {
        if (s.deviceToken === deviceToken && s.isActive) {
          s.isActive = false;
          s.invalidatedAt = new Date();
          s.failureReason = reason;
        }
      }
    },
    removeUserPushSubscription: async (id: number, userId: number) => {
      const idx = pushSubsStore.findIndex(
        (s) => Number(s.id) === id && Number(s.userId) === userId,
      );
      if (idx < 0) return false;
      pushSubsStore.splice(idx, 1);
      return true;
    },
    getOrCreateQuotaUsage: async (params: {
      channel: number;
      providerCode: string;
      periodType: 'DAILY' | 'MONTHLY';
      periodKey: string;
      currency: string;
    }) => {
      const existing = quotaUsagesStore.find(
        (q) =>
          Number(q.channel) === params.channel &&
          q.providerCode === params.providerCode &&
          q.periodType === params.periodType &&
          q.periodKey === params.periodKey,
      );
      if (existing) return existing;
      const created = {
        id: nextQuotaId++,
        channel: params.channel,
        providerCode: params.providerCode,
        periodType: params.periodType,
        periodKey: params.periodKey,
        totalSent: 0,
        totalDelivered: 0,
        totalFailed: 0,
        totalSuppressed: 0,
        totalSegments: 0,
        totalCost: '0.0000',
        currency: params.currency,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as NotificationQuotaUsageEntity;
      quotaUsagesStore.push(created);
      return created;
    },
    recordQuotaDelta: async (params: {
      channel: number;
      providerCode: string;
      dailyPeriodKey: string;
      monthlyPeriodKey: string;
      currency: string;
      sentDelta?: number;
      deliveredDelta?: number;
      failedDelta?: number;
      suppressedDelta?: number;
      segmentsDelta?: number;
      costDelta?: number;
    }) => {
      for (const p of [
        { type: 'DAILY' as const, key: params.dailyPeriodKey },
        { type: 'MONTHLY' as const, key: params.monthlyPeriodKey },
      ]) {
        const usage = await channelsRepo.getOrCreateQuotaUsage({
          channel: params.channel,
          providerCode: params.providerCode,
          periodType: p.type,
          periodKey: p.key,
          currency: params.currency,
        });
        usage.totalSent = Number(usage.totalSent) + (params.sentDelta ?? 0);
        usage.totalDelivered = Number(usage.totalDelivered) + (params.deliveredDelta ?? 0);
        usage.totalFailed = Number(usage.totalFailed) + (params.failedDelta ?? 0);
        usage.totalSuppressed = Number(usage.totalSuppressed) + (params.suppressedDelta ?? 0);
        usage.totalSegments = Number(usage.totalSegments) + (params.segmentsDelta ?? 0);
        usage.totalCost = (Number(usage.totalCost) + (params.costDelta ?? 0)).toFixed(4);
      }
    },
  } as unknown as NotificationChannelsRepository;

  const mapper = new NotificationsMapper();
  const adapterRegistry = new NotificationChannelAdapterRegistry(
    new EmailChannelProviderAdapter(),
    new SmsChannelProviderAdapter(),
    new PushChannelProviderAdapter(),
  );
  const channelsService = new NotificationChannelsService(
    channelsRepo,
    adapterRegistry,
    mapper,
    null,
    usersPublicService,
  );
  const service = new NotificationsService(
    notificationsRepo,
    recipientsRepo,
    preferencesRepo,
    mapper,
    null,
    usersPublicService,
    rolesPublicService,
    organizationsPublicService,
    sequenceRegistry,
    channelsService,
  );
  const controller = new NotificationsController(service, channelsService);

  return {
    service,
    channelsService,
    adapterRegistry,
    controller,
    notificationsStore,
    recipientsStore,
    preferencesStore,
    templatesStore,
    deliveriesStore,
    suppressionsStore,
    pushSubsStore,
    quotaUsagesStore,
  };
}

describe('Phase 7.1 — In-App Notifications Module (Backend Unit & Feature Tests)', () => {
  beforeEach(() => {
    defaultFeatureFlagRegistry.setInstalledModules([
      'core',
      'organizations',
      'roles',
      'users',
      'auth',
      'codes',
      'settings',
      'files',
      'notifications',
    ]);
  });

  it('1. Tạo thông báo cho một người dùng (SINGLE_USER) & hiển thị trong hộp thư', async () => {
    const { service, controller } = createInMemoryNotificationsHarness();

    const dispatched = await service.dispatch({
      title: 'Chào mừng thành viên mới',
      content: 'Tài khoản của bạn đã được kích hoạt thành công.',
      category: 'SYSTEM',
      priority: 'NORMAL',
      targetType: 'SINGLE_USER',
      userId: 1,
    });

    expect(dispatched.code).toMatch(/^NTF-\d{4}-\d{6}$/);
    expect(dispatched.targetType).toBe(NOTIFICATION_TARGET_TYPE.SINGLE_USER);
    expect(dispatched.totalTargeted).toBe(1);
    expect(dispatched.totalDelivered).toBe(1);

    const inbox = await controller.listInbox({
      page: 1,
      limit: 20,
      inboxStatus: NOTIFICATION_INBOX_STATUS.ACTIVE,
      isRead: undefined,
      category: undefined,
      priority: undefined,
      search: undefined,
    });

    expect(inbox.data).toHaveLength(1);
    expect(inbox.data[0]?.title).toBe('Chào mừng thành viên mới');
    expect(inbox.data[0]?.isRead).toBe(false);
  });

  it('2. Tạo thông báo cho nhiều người dùng theo nhóm (USER_GROUP) và theo vai trò (ROLE)', async () => {
    const { service } = createInMemoryNotificationsHarness();

    const groupDispatch = await service.dispatch({
      title: 'Thông báo nhóm dự án',
      content: 'Họp giao ban lúc 09:00 sáng mai.',
      category: 'WORK',
      priority: 'HIGH',
      targetType: 'USER_GROUP',
      userIds: [1, 2, 3],
    });
    expect(groupDispatch.totalTargeted).toBe(3);
    expect(groupDispatch.totalDelivered).toBe(3);

    const roleDispatch = await service.dispatch({
      title: 'Cảnh báo dành cho Ban Quản trị',
      content: 'Vui lòng rà soát nhật ký bảo mật định kỳ.',
      category: 'SECURITY',
      priority: 'URGENT',
      targetType: 'ROLE',
      roleIds: [1, 2],
    });
    expect(roleDispatch.targetType).toBe(NOTIFICATION_TARGET_TYPE.ROLE);
    expect(roleDispatch.totalTargeted).toBe(3); // Role 1 -> [1,2], Role 2 -> [2,3] => union [1,2,3]
    expect(roleDispatch.totalDelivered).toBe(3);
  });

  it('3. Tạo thông báo theo đơn vị (ORG_UNIT) kèm đơn vị con & chặn khi không có module Organization', async () => {
    const { service } = createInMemoryNotificationsHarness();

    const orgDispatch = await service.dispatch({
      title: 'Thông báo toàn Trụ sở & Chi nhánh trực thuộc',
      content: 'Áp dụng quy trình làm việc mới từ tháng này.',
      category: 'ANNOUNCEMENT',
      priority: 'NORMAL',
      targetType: 'ORG_UNIT',
      organizationUnitIds: [1],
      includeSubUnits: true,
    });

    expect(orgDispatch.targetType).toBe(NOTIFICATION_TARGET_TYPE.ORG_UNIT);
    // Unit 1 + SubUnit 2 => Users [1, 2, 3, 4]
    expect(orgDispatch.totalTargeted).toBe(4);
    expect(orgDispatch.totalDelivered).toBe(4);

    // Khi hệ thống không cài module organizations -> chặn gửi theo đơn vị
    defaultFeatureFlagRegistry.setInstalledModules(['core', 'users', 'roles', 'notifications']);
    await expect(
      service.dispatch({
        title: 'Test lỗi khi tắt module Organizations',
        content: 'Nội dung test',
        targetType: 'ORG_UNIT',
        organizationUnitIds: [1],
      }),
    ).rejects.toThrow();
  });

  it('4. Đánh dấu đã đọc / chưa đọc & cập nhật chính xác số lượng thông báo mới (unreadCount)', async () => {
    const { service } = createInMemoryNotificationsHarness();

    await service.dispatch({
      title: 'Tin số 1',
      content: 'Nội dung 1',
      category: 'SYSTEM',
      targetType: 'SINGLE_USER',
      userId: 1,
    });
    await service.dispatch({
      title: 'Tin số 2',
      content: 'Nội dung 2',
      category: 'WORK',
      targetType: 'SINGLE_USER',
      userId: 1,
    });

    let summary = await service.getUnreadSummary(1);
    expect(summary.unreadCount).toBe(2);
    expect(summary.byCategory.SYSTEM).toBe(1);
    expect(summary.byCategory.WORK).toBe(1);

    // Đánh dấu đã đọc thông báo #1
    const readRes = await service.setReadState(1, 1, { isRead: true });
    expect(readRes.isRead).toBe(true);
    expect(readRes.unreadCount).toBe(1);

    // Đánh dấu chưa đọc lại cho thông báo #1
    const unreadRes = await service.setReadState(1, 1, { isRead: false });
    expect(unreadRes.isRead).toBe(false);
    expect(unreadRes.unreadCount).toBe(2);

    // Đánh dấu đã đọc tất cả
    const markAll = await service.markAllAsRead(1);
    expect(markAll.updatedCount).toBe(2);
    expect(markAll.unreadCount).toBe(0);

    summary = await service.getUnreadSummary(1);
    expect(summary.unreadCount).toBe(0);
  });

  it('5. Lưu trữ (Archive) và Xóa thông báo khỏi hộp thư cá nhân KHÔNG ảnh hưởng lịch sử gửi gốc', async () => {
    const { service } = createInMemoryNotificationsHarness();

    const dispatched = await service.dispatch({
      title: 'Thông báo kiểm chứng lưu trữ & xóa độc lập lịch sử gửi',
      content: 'Nội dung quan trọng',
      category: 'SYSTEM',
      targetType: 'USER_GROUP',
      userIds: [1, 2],
    });

    // User 1 lưu trữ thông báo (entryId = 1)
    const archivedRes = await service.setArchiveState(1, 1, { archived: true });
    expect(archivedRes.inboxStatus).toBe(NOTIFICATION_INBOX_STATUS.ARCHIVED);

    // User 1 xóa thông báo khỏi hộp thư cá nhân
    const deletedRes = await service.deleteFromInbox(1, 1);
    expect(deletedRes.deleted).toBe(true);
    expect(deletedRes.dispatchHistoryPreserved).toBe(true);

    // Hộp thư của User 1 không còn hiển thị thông báo đã xóa
    const user1Inbox = await service.listUserInbox(1, {
      page: 1,
      limit: 20,
      inboxStatus: NOTIFICATION_INBOX_STATUS.ACTIVE,
      isRead: undefined,
      category: undefined,
      priority: undefined,
      search: undefined,
    });
    expect(user1Inbox.data).toHaveLength(0);

    // Hộp thư của User 2 vẫn còn nguyên
    const user2Inbox = await service.listUserInbox(2, {
      page: 1,
      limit: 20,
      inboxStatus: NOTIFICATION_INBOX_STATUS.ACTIVE,
      isRead: undefined,
      category: undefined,
      priority: undefined,
      search: undefined,
    });
    expect(user2Inbox.data).toHaveLength(1);

    // Lịch sử gửi gốc (Dispatch History) vẫn còn nguyên vẹn 100%
    const history = await service.listDispatchHistory({
      page: 1,
      limit: 20,
      search: undefined,
      category: undefined,
      priority: undefined,
      targetType: undefined,
      organizationUnitId: undefined,
    });
    expect(history.data).toHaveLength(1);
    expect(history.data[0]?.id).toBe(dispatched.id);
    expect(history.data[0]?.totalTargeted).toBe(2);
    expect(history.data[0]?.totalDelivered).toBe(2);
    expect(history.data[0]?.deletedFromInboxCount).toBe(1);
  });

  it('6 & 7. Phân nhóm thông báo & Thiết lập sở thích nhận thông báo (tự động lọc theo kênh được phép)', async () => {
    const { service } = createInMemoryNotificationsHarness();

    // Kiểm tra 4 phân nhóm mặc định trong sở thích của User 2
    const initialPrefs = await service.getUserPreferences(2);
    expect(initialPrefs.map((p) => p.category)).toEqual([
      NOTIFICATION_CATEGORY.SYSTEM,
      NOTIFICATION_CATEGORY.WORK,
      NOTIFICATION_CATEGORY.SECURITY,
      NOTIFICATION_CATEGORY.ANNOUNCEMENT,
    ]);

    // User 2 tắt kênh IN_APP của phân nhóm WORK, và thử tắt kênh IN_APP của nhóm SECURITY
    const updatedPrefs = await service.updateUserPreferences(2, {
      preferences: [
        { category: 'WORK', inAppEnabled: false, emailEnabled: true },
        { category: 'SECURITY', inAppEnabled: false }, // Sẽ bị giữ là true do lockSecurityInApp = true
      ],
    });

    const workPref = updatedPrefs.find((p) => p.category === NOTIFICATION_CATEGORY.WORK);
    const secPref = updatedPrefs.find((p) => p.category === NOTIFICATION_CATEGORY.SECURITY);
    expect(workPref?.inAppEnabled).toBe(false);
    expect(secPref?.inAppEnabled).toBe(true); // Bảo mật luôn được khóa bật In-App

    // Khi phát thông báo nhóm WORK cho User 1 và User 2 qua kênh IN_APP:
    // User 1 nhận được, User 2 bị bỏ qua do đã tắt kênh IN_APP cho nhóm WORK
    const workDispatch = await service.dispatch({
      title: 'Giao việc mới',
      content: 'Cập nhật báo cáo tiến độ',
      category: 'WORK',
      priority: NOTIFICATION_PRIORITY.HIGH,
      targetType: 'USER_GROUP',
      userIds: [1, 2],
      channels: ['IN_APP'],
    });

    expect(workDispatch.totalTargeted).toBe(2);
    expect(workDispatch.totalDelivered).toBe(1);
    expect(workDispatch.totalSkippedByPref).toBe(1);
  });
});

describe('Phase 7.2 — Email, SMS & Push Notification (Multi-Channel Backend Suite)', () => {
  beforeEach(() => {
    defaultFeatureFlagRegistry.setInstalledModules([
      'core',
      'organizations',
      'roles',
      'users',
      'auth',
      'codes',
      'settings',
      'files',
      'notifications',
    ]);
  });

  it('1. Gửi Email theo Template (tách nội dung khỏi code nghiệp vụ, render biến động & HTML)', async () => {
    const { service, channelsService } = createInMemoryNotificationsHarness();

    // Tạo template tùy chỉnh cho Email
    const tpl = await channelsService.upsertTemplate({
      code: 'ORDER_CONFIRMATION',
      name: 'Xác nhận đơn hàng',
      channel: NOTIFICATION_CHANNEL.EMAIL,
      category: NOTIFICATION_CATEGORY.WORK,
      locale: 'vi',
      subjectTemplate: '[Đơn hàng #{{orderCode}}] Xin chào {{fullName}}',
      bodyTemplate:
        'Đơn hàng {{orderCode}} trị giá {{amount}} VND của {{fullName}} đã được xác nhận.',
      htmlTemplate: '<p>Đơn hàng <b>{{orderCode}}</b> trị giá {{amount}} VND của {{fullName}}</p>',
    });
    expect(tpl.code).toBe('ORDER_CONFIRMATION');
    expect(tpl.variables).toEqual(expect.arrayContaining(['orderCode', 'fullName', 'amount']));

    // Phát thông báo chỉ cần truyền templateCode + templateVariables (không cần truyền cứng title/content)
    const dispatched = await service.dispatch({
      templateCode: 'ORDER_CONFIRMATION',
      templateVariables: {
        orderCode: 'ORD-9988',
        amount: '1,500,000',
      },
      category: 'WORK',
      targetType: 'SINGLE_USER',
      userId: 1,
      channels: ['IN_APP', 'EMAIL'],
    });

    expect(dispatched.title).toContain('ORD-9988');
    expect(dispatched.channelDeliveries).toHaveLength(1);
    const emailDelivery = dispatched.channelDeliveries?.[0];
    expect(emailDelivery?.channel).toBe(NOTIFICATION_CHANNEL.EMAIL);
    expect(emailDelivery?.destination).toBe('user_1@example.com');
    expect(emailDelivery?.renderedSubject).toBe('[Đơn hàng #ORD-9988] Xin chào Người dùng #1');
    expect(emailDelivery?.renderedBody).toBe(
      'Đơn hàng ORD-9988 trị giá 1,500,000 VND của Người dùng #1 đã được xác nhận.',
    );
    expect(emailDelivery?.status).toBe(NOTIFICATION_DELIVERY_STATUS.DELIVERED);
  });

  it('2. Gửi SMS qua nhà cung cấp (dùng Adapter riêng, chuẩn hóa SĐT +84 và tính đúng số segment GSM-7 vs Unicode)', async () => {
    const { service } = createInMemoryNotificationsHarness();

    // Kiểm tra hàm tính segment GSM-7 vs Unicode tiếng Việt
    const gsmSeg = calculateSmsSegments('Ma OTP cua ban la 123456. Hieu luc 5 phut.');
    expect(gsmSeg.encoding).toBe('GSM_7BIT');
    expect(gsmSeg.segmentsCount).toBe(1);

    const longUnicodeText =
      'Thông báo khẩn: Hệ thống sẽ bảo trì định kỳ từ 23:00 hôm nay đến 02:00 sáng mai. Vui lòng lưu lại toàn bộ công việc đang thực hiện để tránh mất dữ liệu.';
    const unicodeSeg = calculateSmsSegments(longUnicodeText);
    expect(unicodeSeg.encoding).toBe('UCS2_UNICODE');
    expect(unicodeSeg.segmentsCount).toBeGreaterThanOrEqual(3); // > 134 ký tự Unicode -> 3 segments

    // Cấu hình SMS Provider sang VIETTEL và đơn giá 800 VND/segment
    await service.updateRuntimeConfig({
      smsProvider: 'VIETTEL',
      smsSenderId: 'CORE_VN',
      smsCostPerSegment: 800,
    });

    const dispatched = await service.dispatch({
      title: 'Cảnh báo bảo trì SMS',
      content: longUnicodeText,
      category: 'SECURITY',
      targetType: 'SINGLE_USER',
      userId: 1,
      channels: ['SMS'],
      forceDeliver: true,
    });

    const smsDelivery = dispatched.channelDeliveries?.[0];
    expect(smsDelivery?.channel).toBe(NOTIFICATION_CHANNEL.SMS);
    expect(smsDelivery?.providerCode).toBe('VIETTEL');
    expect(smsDelivery?.destination).toBe('+84901000001'); // Chuẩn hóa từ 0901000001 -> +84901000001
    expect(smsDelivery?.segmentsCount).toBe(unicodeSeg.segmentsCount);
    expect(smsDelivery?.estimatedCost).toBe(unicodeSeg.segmentsCount * 800);
    expect(smsDelivery?.status).toBe(NOTIFICATION_DELIVERY_STATUS.DELIVERED);
  });

  it('3. Gửi Push Notification cho Web Push / Mobile Push tới các thiết bị đã đăng ký của người dùng', async () => {
    const { service, channelsService } = createInMemoryNotificationsHarness();

    // User 1 đăng ký 2 thiết bị nhận Push (Web Push & FCM Android)
    await channelsService.registerPushSubscription(1, {
      platform: 'WEB_PUSH',
      deviceToken: 'webpush_token_chrome_user1_valid_12345',
      endpoint: 'https://fcm.googleapis.com/fcm/send/chrome1',
      deviceName: 'Chrome on Ubuntu',
    });
    await channelsService.registerPushSubscription(1, {
      platform: 'FCM_ANDROID',
      deviceToken: 'fcm_android_token_pixel8_user1_valid_67890',
      deviceName: 'Pixel 8 Pro',
    });

    const dispatched = await service.dispatch({
      title: 'Thông báo đẩy mới',
      content: 'Bạn có nhiệm vụ mới cần phê duyệt.',
      category: 'WORK',
      targetType: 'SINGLE_USER',
      userId: 1,
      channels: ['PUSH'],
    });

    // Cả 2 thiết bị của User 1 đều nhận được Push Notification
    expect(dispatched.channelDeliveries).toHaveLength(2);
    expect(
      dispatched.channelDeliveries?.every(
        (d) => d.status === NOTIFICATION_DELIVERY_STATUS.DELIVERED,
      ),
    ).toBe(true);
  });

  it('4. Theo dõi vòng đời trạng thái gửi: Queued -> Sent -> Delivered / Failed qua Webhook', async () => {
    const { service, channelsService } = createInMemoryNotificationsHarness();

    // Gửi ở chế độ chỉ dừng ở SENT (chờ Webhook xác nhận DELIVERED)
    const dispatched = await service.dispatch({
      title: 'Theo dõi trạng thái gửi',
      content: 'Kiểm tra trạng thái Sent -> Delivered',
      category: 'SYSTEM',
      targetType: 'SINGLE_USER',
      userId: 1,
      channels: ['EMAIL'],
      metadata: {
        simulateQueuedSentOnly: true,
      },
    });

    const deliv = dispatched.channelDeliveries?.[0];
    expect(deliv).toBeDefined();
    expect(deliv!.status).toBe(NOTIFICATION_DELIVERY_STATUS.SENT);
    expect(deliv!.sentAt).not.toBeNull();
    expect(deliv!.deliveredAt).toBeNull();

    // Provider gọi Webhook báo đã chuyển thành công tới hộp thư (DELIVERED)
    const updated = await channelsService.updateDeliveryStatusWebhook(deliv!.id, {
      status: 'DELIVERED',
      providerMessageId: 'smtp-webhook-confirmed-001',
    });
    expect(updated.status).toBe(NOTIFICATION_DELIVERY_STATUS.DELIVERED);
    expect(updated.deliveredAt).not.toBeNull();
    expect(updated.providerMessageId).toBe('smtp-webhook-confirmed-001');
  });

  it('5. Tự động gửi lại khi lỗi tạm thời (Exponential Backoff) & Chống gửi trùng nhờ Idempotency Key', async () => {
    const { service, channelsService } = createInMemoryNotificationsHarness();

    await service.updateRuntimeConfig({
      retryEnabled: true,
      retryMaxAttempts: 3,
      retryBaseDelaySec: 10,
    });

    // Lần 1: Gửi gặp lỗi tạm thời (TRANSIENT timeout 503) -> Trạng thái giữ ở QUEUED kèm nextRetryAt
    const dispatched = await service.dispatch({
      title: 'Kiểm tra Retry & Idempotency',
      content: 'Nội dung kiểm thử lỗi tạm thời',
      category: 'SYSTEM',
      targetType: 'SINGLE_USER',
      userId: 1,
      channels: ['EMAIL'],
      idempotencyKey: 'UNIQUE-CAMPAIGN-KEY-2026-001',
      metadata: {
        simulateDeliveryFailure: 'TRANSIENT',
      },
    });

    const firstAttempt = dispatched.channelDeliveries?.[0];
    expect(firstAttempt).toBeDefined();
    expect(firstAttempt!.status).toBe(NOTIFICATION_DELIVERY_STATUS.QUEUED);
    expect(firstAttempt!.errorType).toBe(NOTIFICATION_ERROR_TYPE.TRANSIENT);
    expect(firstAttempt!.attemptCount).toBe(1);
    expect(firstAttempt!.nextRetryAt).not.toBeNull();

    // Gọi lại dispatch với CÙNG idempotencyKey -> Hệ thống chống gửi trùng (deduplicatedCount = 1)
    const duplicateDispatch = await service.dispatch({
      title: 'Kiểm tra Retry & Idempotency',
      content: 'Nội dung kiểm thử lỗi tạm thời',
      category: 'SYSTEM',
      targetType: 'SINGLE_USER',
      userId: 1,
      channels: ['EMAIL'],
      idempotencyKey: 'UNIQUE-CAMPAIGN-KEY-2026-001',
    });
    expect(duplicateDispatch.deliverySummary?.deduplicatedCount).toBe(1);
    expect(duplicateDispatch.channelDeliveries?.[0]?.id).toBe(firstAttempt!.id);

    // Chạy tiến trình retryDueDeliveries tại thời điểm tương lai sau nextRetryAt -> Gửi thành công!
    const futureTime = new Date(Date.now() + 60_000);
    const retryBatchRes = await channelsService.retryDueDeliveries(futureTime);
    expect(retryBatchRes.retriedCount).toBe(1);
    expect(retryBatchRes.succeededCount).toBe(1);
    expect(retryBatchRes.items[0]?.status).toBe(NOTIFICATION_DELIVERY_STATUS.DELIVERED);
    expect(retryBatchRes.items[0]?.attemptCount).toBe(2);

    // Nếu gọi retrySingleDelivery thêm lần nữa khi đã DELIVERED -> Idempotency giữ nguyên attemptCount = 2, không gửi lại!
    const retryAfterDelivered = await channelsService.retrySingleDelivery(firstAttempt!.id);
    expect(retryAfterDelivered.attemptCount).toBe(2);
    expect(retryAfterDelivered.status).toBe(NOTIFICATION_DELIVERY_STATUS.DELIVERED);
  });

  it('6. Dừng gửi khi địa chỉ hoặc Push Token không hợp lệ (Auto-Suppression & Vô hiệu hóa Push Token chết)', async () => {
    const { service, channelsService } = createInMemoryNotificationsHarness();

    // Đăng ký 1 Push Token bị hỏng (unregistered) cho User 2
    await channelsService.registerPushSubscription(2, {
      platform: 'FCM_ANDROID',
      deviceToken: 'dead_token_unregistered_device_999',
      deviceName: 'Old Android Phone',
    });

    // Gửi Email vào địa chỉ bounce@example.com và Push vào dead_token
    const firstSend = await service.dispatch({
      title: 'Kiểm tra Hard Bounce & Dead Push Token',
      content: 'Nội dung test suppression',
      category: 'SECURITY',
      targetType: 'SINGLE_USER',
      userId: 2,
      channels: ['EMAIL', 'PUSH'],
      forceDeliver: true,
      metadata: {
        emailOverride: 'bounce@example.com',
      },
    });

    const emailDeliv1 = firstSend.channelDeliveries?.find(
      (d) => d.channel === NOTIFICATION_CHANNEL.EMAIL,
    );
    const pushDeliv1 = firstSend.channelDeliveries?.find(
      (d) => d.channel === NOTIFICATION_CHANNEL.PUSH,
    );

    expect(emailDeliv1?.status).toBe(NOTIFICATION_DELIVERY_STATUS.FAILED);
    expect(emailDeliv1?.errorType).toBe(NOTIFICATION_ERROR_TYPE.PERMANENT);
    expect(pushDeliv1?.status).toBe(NOTIFICATION_DELIVERY_STATUS.FAILED);

    // Kiểm tra Suppression List đã tự động ghi nhận cả 2 đích lỗi vĩnh viễn
    const suppressions = await channelsService.listSuppressions({
      page: 1,
      limit: 20,
      channel: undefined,
      reason: undefined,
      isActive: true,
      search: undefined,
    });
    expect(suppressions.data).toHaveLength(2);
    expect(suppressions.data.map((s) => s.reason)).toEqual(
      expect.arrayContaining([
        NOTIFICATION_SUPPRESSION_REASON.HARD_BOUNCE,
        NOTIFICATION_SUPPRESSION_REASON.UNREGISTERED_TOKEN,
      ]),
    );

    // Kiểm tra Push Token của User 2 đã tự động bị chuyển isActive = false
    const user2Subs = await channelsService.listUserPushSubscriptions(2);
    expect(user2Subs[0]?.isActive).toBe(false);

    // Lần gửi tiếp theo tới cùng địa chỉ bounce@example.com -> Tự động DỪNG GỬI (SUPPRESSED) ngay lập tức!
    const secondSend = await service.dispatch({
      title: 'Lần gửi thứ 2 tới địa chỉ đã bị chặn',
      content: 'Hệ thống phải chặn ngay không gọi provider',
      category: 'SECURITY',
      targetType: 'SINGLE_USER',
      userId: 2,
      channels: ['EMAIL'],
      forceDeliver: true,
      metadata: {
        emailOverride: 'bounce@example.com',
      },
    });

    const emailDeliv2 = secondSend.channelDeliveries?.[0];
    expect(emailDeliv2).toBeDefined();
    expect(emailDeliv2!.status).toBe(NOTIFICATION_DELIVERY_STATUS.SUPPRESSED);
    expect(emailDeliv2!.attemptCount).toBe(0); // Không tốn lượt gọi sang nhà cung cấp
  });

  it('7. Gửi thông báo hàng loạt theo Batch (chia lô theo dispatchBatchSize, gắn batchKey chuẩn)', async () => {
    const { service } = createInMemoryNotificationsHarness();

    // Thiết lập kích thước mỗi batch là 2 lệnh gửi
    await service.updateRuntimeConfig({
      dispatchBatchSize: 2,
    });

    // Gửi cho 4 người dùng qua kênh EMAIL -> 4 lệnh gửi chia thành 2 batch (mỗi batch 2 lệnh)
    const dispatched = await service.dispatch({
      title: 'Chiến dịch gửi hàng loạt theo lô',
      content: 'Nội dung bản tin hàng loạt',
      category: 'SYSTEM',
      targetType: 'USER_GROUP',
      userIds: [1, 2, 3, 4],
      channels: ['EMAIL'],
    });

    expect(dispatched.deliverySummary?.totalChannelDeliveries).toBe(4);
    expect(dispatched.deliverySummary?.batchSize).toBe(2);
    expect(dispatched.deliverySummary?.totalBatches).toBe(2);

    const batchKeys = [...new Set(dispatched.channelDeliveries?.map((d) => d.batchKey))];
    expect(batchKeys).toHaveLength(2);
    expect(batchKeys[0]).toMatch(/-B001$/);
    expect(batchKeys[1]).toMatch(/-B002$/);
  });

  it('8. Theo dõi chi phí & giới hạn Quota/Budget nhà cung cấp (tự động chặn khi vượt hạn mức SMS)', async () => {
    const { service, channelsService } = createInMemoryNotificationsHarness();

    // Thiết lập hạn mức SMS tối đa 2 segment/ngày, đơn giá 1000 VND/segment, bật chặn cứng khi vượt quota
    await service.updateRuntimeConfig({
      smsProvider: 'FPT',
      smsDailyQuota: 2,
      smsMonthlyBudget: 5000,
      smsCostPerSegment: 1000,
      quotaHardStopOnExceed: true,
    });

    // Gửi cho 3 người dùng (mỗi người 1 segment SMS) -> 2 người đầu thành công, người thứ 3 bị chặn do chạm trần smsDailyQuota = 2
    const dispatched = await service.dispatch({
      title: 'Test Quota SMS',
      content: 'Tin nhan ngan 1 segment.',
      category: 'SECURITY',
      targetType: 'USER_GROUP',
      userIds: [1, 2, 3],
      channels: ['SMS'],
      forceDeliver: true,
    });

    expect(dispatched.deliverySummary?.deliveredCount).toBe(2);
    expect(dispatched.deliverySummary?.failedCount).toBe(1);
    expect(dispatched.deliverySummary?.totalSmsSegments).toBe(2);
    expect(dispatched.deliverySummary?.totalEstimatedCost).toBe(2000);

    const failedItem = dispatched.channelDeliveries?.find(
      (d) => d.status === NOTIFICATION_DELIVERY_STATUS.FAILED,
    );
    expect(failedItem?.errorType).toBe(NOTIFICATION_ERROR_TYPE.QUOTA_EXCEEDED);
    expect(failedItem?.errorCode).toBe('SMS_DAILY_QUOTA_EXCEEDED');

    // Kiểm tra báo cáo tổng hợp Quota & Chi phí
    const quotaSummary = await channelsService.getQuotaAndCostSummary();
    const smsQuota = quotaSummary.channels.find((c) => c.channel === NOTIFICATION_CHANNEL.SMS);
    expect(smsQuota?.providerCode).toBe('FPT');
    expect(smsQuota?.dailySegments).toBe(2);
    expect(smsQuota?.dailyCost).toBe(2000);
    expect(smsQuota?.dailyUsagePercent).toBe(100);
    expect(smsQuota?.isQuotaExceeded).toBe(true);
  });
});
