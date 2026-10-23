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
  NOTIFICATION_CATEGORY,
  NOTIFICATION_INBOX_STATUS,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
  NotificationsController,
  NotificationsMapper,
  NotificationsService,
} from '@modules/notifications/index.js';
import type { NotificationPreferenceEntity } from '@modules/notifications/entities/notification-preference.entity.js';
import type { NotificationRecipientEntity } from '@modules/notifications/entities/notification-recipient.entity.js';
import type { NotificationEntity } from '@modules/notifications/entities/notification.entity.js';
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
  let nextNotifId = 1;
  let nextRecId = 1;
  let nextPrefId = 1;

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

  const mapper = new NotificationsMapper();
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
  );
  const controller = new NotificationsController(service);

  return {
    service,
    controller,
    notificationsStore,
    recipientsStore,
    preferencesStore,
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
