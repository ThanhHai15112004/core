import { useCallback, useEffect, useState } from 'react';
import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import {
  emitNotificationUnreadChanged,
  notificationsApi,
} from '../services/notifications.api';
import type {
  ListDispatchesFilterParams,
  ListInboxFilterParams,
  NotificationDispatchDetail,
  NotificationDispatchHistoryItem,
  NotificationInboxItem,
  NotificationPreferenceItem,
  NotificationRuntimeConfig,
  NotificationUnreadSummary,
  SendNotificationPayload,
} from '../types/notifications.types';

export interface SimpleLookupOption {
  id: number;
  code: string;
  name: string;
}

export function useNotifications() {
  const [inboxItems, setInboxItems] = useState<NotificationInboxItem[]>([]);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [inboxFilters, setInboxFilters] = useState<ListInboxFilterParams>({
    page: 1,
    limit: 20,
    inboxStatus: 'ACTIVE',
  });
  const [selectedInboxItem, setSelectedInboxItem] = useState<NotificationInboxItem | null>(null);

  const [unreadSummary, setUnreadSummary] = useState<NotificationUnreadSummary>({
    unreadCount: 0,
    totalActiveCount: 0,
    totalArchivedCount: 0,
    byCategory: { SYSTEM: 0, WORK: 0, SECURITY: 0, ANNOUNCEMENT: 0 },
  });

  const [dispatches, setDispatches] = useState<NotificationDispatchHistoryItem[]>([]);
  const [dispatchesTotal, setDispatchesTotal] = useState(0);
  const [dispatchFilters, setDispatchFilters] = useState<ListDispatchesFilterParams>({
    page: 1,
    limit: 20,
  });
  const [selectedDispatchDetail, setSelectedDispatchDetail] =
    useState<NotificationDispatchDetail | null>(null);

  const [preferences, setPreferences] = useState<NotificationPreferenceItem[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<NotificationRuntimeConfig | null>(null);

  const [usersLookup, setUsersLookup] = useState<SimpleLookupOption[]>([]);
  const [rolesLookup, setRolesLookup] = useState<SimpleLookupOption[]>([]);
  const [orgUnitsLookup, setOrgUnitsLookup] = useState<SimpleLookupOption[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refreshUnreadSummary = useCallback(async () => {
    try {
      const summary = await notificationsApi.getUnreadSummary();
      setUnreadSummary(summary);
      emitNotificationUnreadChanged();
    } catch {
      // Ignore background unread fetch errors
    }
  }, []);

  const loadInbox = useCallback(
    async (overrideFilters?: ListInboxFilterParams) => {
      setLoading(true);
      setError(null);
      try {
        const effective = overrideFilters ?? inboxFilters;
        const result = await notificationsApi.listInbox(effective);
        setInboxItems(result.data);
        setInboxTotal(result.meta?.total ?? result.data.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể tải hộp thư thông báo');
      } finally {
        setLoading(false);
      }
    },
    [inboxFilters],
  );

  const loadDispatches = useCallback(
    async (overrideFilters?: ListDispatchesFilterParams) => {
      setLoading(true);
      setError(null);
      try {
        const effective = overrideFilters ?? dispatchFilters;
        const result = await notificationsApi.listDispatches(effective);
        setDispatches(result.data);
        setDispatchesTotal(result.meta?.total ?? result.data.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể tải lịch sử gửi thông báo');
      } finally {
        setLoading(false);
      }
    },
    [dispatchFilters],
  );

  const loadPreferencesAndConfig = useCallback(async () => {
    try {
      const [prefs, cfg] = await Promise.all([
        notificationsApi.getPreferences(),
        notificationsApi.getConfig(),
      ]);
      setPreferences(prefs);
      setRuntimeConfig(cfg);
    } catch {
      // Ignore optional config load errors
    }
  }, []);

  const loadTargetLookups = useCallback(async () => {
    try {
      const [usersRes, rolesRes, orgsRes] = await Promise.allSettled([
        fetchApi<Array<{ id: number; username: string; fullName?: string; email?: string }>>(
          API_ROUTES.USERS.LIST('limit=100'),
        ),
        fetchApi<Array<{ id: number; code: string; name: string }>>(
          API_ROUTES.ROLES.LIST('limit=100'),
        ),
        fetchApi<Array<{ id: number; code: string; name: string }>>(
          API_ROUTES.ORGANIZATIONS.LIST('limit=100'),
        ),
      ]);

      if (usersRes.status === 'fulfilled' && Array.isArray(usersRes.value)) {
        setUsersLookup(
          usersRes.value.map((u) => ({
            id: u.id,
            code: u.username,
            name: `${u.fullName || u.username} (${u.email || u.username})`,
          })),
        );
      }
      if (rolesRes.status === 'fulfilled' && Array.isArray(rolesRes.value)) {
        setRolesLookup(
          rolesRes.value.map((r) => ({
            id: r.id,
            code: r.code,
            name: `${r.name} (${r.code})`,
          })),
        );
      }
      if (orgsRes.status === 'fulfilled' && Array.isArray(orgsRes.value)) {
        setOrgUnitsLookup(
          orgsRes.value.map((o) => ({
            id: o.id,
            code: o.code,
            name: `${o.name} (${o.code})`,
          })),
        );
      }
    } catch {
      // Ignore lookup failures
    }
  }, []);

  useEffect(() => {
    void refreshUnreadSummary();
    void loadPreferencesAndConfig();
    void loadTargetLookups();
  }, [refreshUnreadSummary, loadPreferencesAndConfig, loadTargetLookups]);

  useEffect(() => {
    void loadInbox(inboxFilters);
  }, [inboxFilters, loadInbox]);

  useEffect(() => {
    void loadDispatches(dispatchFilters);
  }, [dispatchFilters, loadDispatches]);

  const handleToggleRead = useCallback(
    async (item: NotificationInboxItem, isRead: boolean) => {
      try {
        await notificationsApi.setReadState(item.id, isRead);
        await Promise.all([loadInbox(), refreshUnreadSummary(), loadDispatches()]);
        if (selectedInboxItem?.id === item.id) {
          setSelectedInboxItem({ ...selectedInboxItem, isRead });
        }
        setFeedback(
          isRead ? 'Đã đánh dấu thông báo là Đã đọc.' : 'Đã đánh dấu thông báo là Chưa đọc.',
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Thao tác cập nhật trạng thái đọc thất bại');
      }
    },
    [loadInbox, refreshUnreadSummary, loadDispatches, selectedInboxItem],
  );

  const handleMarkAllRead = useCallback(
    async (category?: number | string) => {
      try {
        const res = await notificationsApi.markAllAsRead(category);
        await Promise.all([loadInbox(), refreshUnreadSummary(), loadDispatches()]);
        setFeedback(`Đã đánh dấu đã đọc ${res.updatedCount} thông báo.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể đánh dấu đã đọc tất cả');
      }
    },
    [loadInbox, refreshUnreadSummary, loadDispatches],
  );

  const handleToggleArchive = useCallback(
    async (item: NotificationInboxItem, archived: boolean) => {
      try {
        await notificationsApi.setArchiveState(item.id, archived);
        await Promise.all([loadInbox(), refreshUnreadSummary(), loadDispatches()]);
        if (selectedInboxItem?.id === item.id) {
          setSelectedInboxItem(null);
        }
        setFeedback(
          archived
            ? 'Đã lưu trữ thông báo (Lịch sử gửi gốc vẫn được giữ nguyên).'
            : 'Đã khôi phục thông báo về Hộp thư đến.',
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Thao tác lưu trữ thất bại');
      }
    },
    [loadInbox, refreshUnreadSummary, loadDispatches, selectedInboxItem],
  );

  const handleDeleteFromInbox = useCallback(
    async (item: NotificationInboxItem) => {
      try {
        await notificationsApi.deleteFromInbox(item.id);
        await Promise.all([loadInbox(), refreshUnreadSummary(), loadDispatches()]);
        if (selectedInboxItem?.id === item.id) {
          setSelectedInboxItem(null);
        }
        setFeedback(
          'Đã xóa thông báo khỏi hộp thư cá nhân. Lịch sử gửi của hệ thống hoàn toàn không bị ảnh hưởng.',
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Thao tác xóa khỏi hộp thư thất bại');
      }
    },
    [loadInbox, refreshUnreadSummary, loadDispatches, selectedInboxItem],
  );

  const handleSendNotification = useCallback(
    async (payload: SendNotificationPayload) => {
      setLoading(true);
      setError(null);
      try {
        const dispatched = await notificationsApi.sendNotification(payload);
        await Promise.all([loadInbox(), refreshUnreadSummary(), loadDispatches()]);
        setFeedback(
          `Đã phát thông báo [${dispatched.code}] thành công tới ${dispatched.totalDelivered}/${dispatched.totalTargeted} người nhận!`,
        );
        return dispatched;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gửi thông báo thất bại';
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [loadInbox, refreshUnreadSummary, loadDispatches],
  );

  const handleSavePreferences = useCallback(
    async (
      updatedPrefs: Array<{
        category: number | string;
        inAppEnabled?: boolean;
        emailEnabled?: boolean;
        smsEnabled?: boolean;
        pushEnabled?: boolean;
      }>,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const saved = await notificationsApi.updatePreferences(updatedPrefs);
        setPreferences(saved);
        setFeedback('Đã lưu thiết lập sở thích nhận thông báo của bạn!');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Cập nhật sở thích nhận thông báo thất bại');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleSaveRuntimeConfig = useCallback(
    async (partialConfig: Partial<NotificationRuntimeConfig>) => {
      setLoading(true);
      setError(null);
      try {
        const updated = await notificationsApi.updateConfig(partialConfig);
        setRuntimeConfig(updated);
        await loadPreferencesAndConfig();
        setFeedback('Đã cập nhật cấu hình vận hành hệ thống thông báo!');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Cập nhật cấu hình thất bại');
      } finally {
        setLoading(false);
      }
    },
    [loadPreferencesAndConfig],
  );

  const handleSelectDispatchDetail = useCallback(async (id: number) => {
    try {
      const detail = await notificationsApi.getDispatchDetail(id);
      setSelectedDispatchDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải chi tiết lịch sử gửi');
    }
  }, []);

  return {
    inboxItems,
    inboxTotal,
    inboxFilters,
    setInboxFilters,
    selectedInboxItem,
    setSelectedInboxItem,
    unreadSummary,
    dispatches,
    dispatchesTotal,
    dispatchFilters,
    setDispatchFilters,
    selectedDispatchDetail,
    setSelectedDispatchDetail,
    handleSelectDispatchDetail,
    preferences,
    runtimeConfig,
    usersLookup,
    rolesLookup,
    orgUnitsLookup,
    loading,
    error,
    setError,
    feedback,
    setFeedback,
    refreshUnreadSummary,
    loadInbox,
    loadDispatches,
    handleToggleRead,
    handleMarkAllRead,
    handleToggleArchive,
    handleDeleteFromInbox,
    handleSendNotification,
    handleSavePreferences,
    handleSaveRuntimeConfig,
  };
}

