import { useCallback, useEffect, useMemo, useState } from 'react';
import { USER_STATUS, USERS_TAB, type UsersTabId } from '../enum/users.enum';
import { usersApi } from '../services/users.api';
import type {
  AdminResetMfaResult,
  AdminResetPasswordResult,
  BulkImportUsersResult,
  CreateUserPayload,
  ExportUsersFileResponse,
  ListUsersFilter,
  OrganizationOptionSummary,
  RoleOptionSummary,
  UpdateUserPayload,
  UserItem,
  UserLoginHistoryItem,
  UserOrganizationAssignmentInput,
  UsersPaginationMeta,
  UserStatusHistoryItem,
} from '../types/users.types';

export interface UsersBannerMessage {
  readonly type: 'success' | 'error';
  readonly message: string;
}

export function useUsersManagement() {
  const [activeTab, setActiveTab] = useState<UsersTabId>(USERS_TAB.DIRECTORY);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<UsersBannerMessage | null>(null);

  const [users, setUsers] = useState<UserItem[]>([]);
  const [pagination, setPagination] = useState<UsersPaginationMeta>({
    page: 1,
    limit: 20,
    totalItems: 0,
    totalPages: 1,
  });

  const [filter, setFilter] = useState<ListUsersFilter>({
    q: '',
    status: '',
    roleId: '',
    organizationUnitId: '',
    includeArchived: false,
    mfaEnabled: '',
    page: 1,
    limit: 20,
  });

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [statusHistory, setStatusHistory] = useState<UserStatusHistoryItem[]>([]);
  const [loginHistory, setLoginHistory] = useState<UserLoginHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [roleOptions, setRoleOptions] = useState<RoleOptionSummary[]>([]);
  const [organizationOptions, setOrganizationOptions] = useState<OrganizationOptionSummary[]>([]);

  const [lastPasswordResetResult, setLastPasswordResetResult] =
    useState<AdminResetPasswordResult | null>(null);
  const [lastMfaResetResult, setLastMfaResetResult] = useState<AdminResetMfaResult | null>(null);
  const [lastImportResult, setLastImportResult] = useState<BulkImportUsersResult | null>(null);

  const showError = useCallback((err: unknown, fallback: string) => {
    const msg = err instanceof Error ? err.message : fallback;
    setBanner({ type: 'error', message: msg || fallback });
  }, []);

  const loadReferenceOptions = useCallback(async () => {
    const [rolesRes, orgsRes] = await Promise.allSettled([
      usersApi.listRoleOptions(),
      usersApi.listOrganizationOptions(),
    ]);
    if (rolesRes.status === 'fulfilled' && Array.isArray(rolesRes.value)) {
      setRoleOptions(rolesRes.value);
    }
    if (orgsRes.status === 'fulfilled' && Array.isArray(orgsRes.value)) {
      setOrganizationOptions(orgsRes.value);
    }
  }, []);

  const loadUsers = useCallback(
    async (nextFilter: ListUsersFilter) => {
      setLoading(true);
      try {
        const res = await usersApi.listUsers(nextFilter);
        const list = Array.isArray(res.data) ? res.data : [];
        setUsers(list);
        const rawMeta = res.meta as
          | { page?: number; limit?: number; total?: number; totalItems?: number; totalPages?: number }
          | undefined;
        const totalItems = rawMeta?.totalItems ?? rawMeta?.total ?? list.length;
        const limit = rawMeta?.limit ?? nextFilter.limit ?? 20;
        const page = rawMeta?.page ?? nextFilter.page ?? 1;
        const totalPages = rawMeta?.totalPages ?? Math.max(1, Math.ceil(totalItems / limit));

        setPagination({
          page,
          limit,
          totalItems,
          totalPages,
        });
        setSelectedUserId((prev) => {
          if (prev && list.some((u) => u.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      } catch (err) {
        showError(err, 'Không thể tải danh sách người dùng.');
      } finally {
        setLoading(false);
      }
    },
    [showError],
  );

  const loadSelectedUserHistories = useCallback(async (userId: number) => {
    setLoadingHistory(true);
    try {
      const [statusRes, loginRes] = await Promise.allSettled([
        usersApi.getStatusHistory(userId),
        usersApi.getLoginHistory(userId),
      ]);
      setStatusHistory(
        statusRes.status === 'fulfilled' && Array.isArray(statusRes.value) ? statusRes.value : [],
      );
      setLoginHistory(
        loginRes.status === 'fulfilled' && Array.isArray(loginRes.value) ? loginRes.value : [],
      );
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void loadReferenceOptions();
    void loadUsers({
      q: '',
      status: '',
      roleId: '',
      organizationUnitId: '',
      includeArchived: false,
      mfaEnabled: '',
      page: 1,
      limit: 20,
    });
  }, [loadReferenceOptions, loadUsers]);

  useEffect(() => {
    if (selectedUserId) {
      void loadSelectedUserHistories(selectedUserId);
    } else {
      setStatusHistory([]);
      setLoginHistory([]);
    }
  }, [selectedUserId, loadSelectedUserHistories]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  const stats = useMemo(() => {
    const totalUsers = pagination.totalItems || users.length;
    const activeCount = users.filter((u) => u.status === USER_STATUS.ACTIVE).length;
    const lockedOrInactiveCount = users.filter(
      (u) => u.status === USER_STATUS.LOCKED || u.status === USER_STATUS.INACTIVE,
    ).length;
    const mfaEnabledCount = users.filter((u) => u.mfaEnabled).length;
    return {
      totalUsers,
      activeCount,
      lockedOrInactiveCount,
      mfaEnabledCount,
    };
  }, [users, pagination.totalItems]);

  const applyFilter = useCallback(
    async (patch: Partial<ListUsersFilter>) => {
      const next = { ...filter, ...patch };
      setFilter(next);
      await loadUsers(next);
    },
    [filter, loadUsers],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([loadReferenceOptions(), loadUsers(filter)]);
    if (selectedUserId) {
      await loadSelectedUserHistories(selectedUserId);
    }
  }, [filter, loadReferenceOptions, loadSelectedUserHistories, loadUsers, selectedUserId]);

  const handleCreateUser = useCallback(
    async (payload: CreateUserPayload): Promise<boolean> => {
      setSubmitting(true);
      setBanner(null);
      try {
        const created = await usersApi.createUser(payload);
        setBanner({
          type: 'success',
          message: `Đã tạo tài khoản "${created.fullName} (@${created.username})" thành công.`,
        });
        await loadUsers(filter);
        setSelectedUserId(created.id);
        return true;
      } catch (err) {
        showError(err, 'Tạo người dùng thất bại.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadUsers, showError],
  );

  const handleUpdateUser = useCallback(
    async (id: number, payload: UpdateUserPayload): Promise<boolean> => {
      setSubmitting(true);
      setBanner(null);
      try {
        const updated = await usersApi.updateUser(id, payload);
        setBanner({
          type: 'success',
          message: `Đã cập nhật hồ sơ "${updated.fullName}" thành công.`,
        });
        await loadUsers(filter);
        return true;
      } catch (err) {
        showError(err, 'Cập nhật hồ sơ thất bại.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadUsers, showError],
  );

  const handleAssignRoles = useCallback(
    async (id: number, roleIds: readonly number[]): Promise<boolean> => {
      setSubmitting(true);
      setBanner(null);
      try {
        const updated = await usersApi.assignRoles(id, roleIds);
        setBanner({
          type: 'success',
          message: `Đã cập nhật ${updated.roles.length} vai trò cho "@${updated.username}".`,
        });
        await loadUsers(filter);
        return true;
      } catch (err) {
        showError(err, 'Gán vai trò thất bại.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadUsers, showError],
  );

  const handleAssignOrganizations = useCallback(
    async (
      id: number,
      organizationUnits: readonly UserOrganizationAssignmentInput[],
    ): Promise<boolean> => {
      setSubmitting(true);
      setBanner(null);
      try {
        const updated = await usersApi.assignOrganizations(id, organizationUnits);
        setBanner({
          type: 'success',
          message: `Đã cập nhật ${updated.organizationUnits.length} đơn vị công tác cho "@${updated.username}".`,
        });
        await loadUsers(filter);
        return true;
      } catch (err) {
        showError(err, 'Gán đơn vị công tác thất bại.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadUsers, showError],
  );

  const handleLifecycleAction = useCallback(
    async (
      id: number,
      action: 'lock' | 'unlock' | 'deactivate' | 'activate' | 'archive' | 'restore',
      options?: { reason?: string; lockedUntil?: string | null },
    ): Promise<boolean> => {
      setSubmitting(true);
      setBanner(null);
      try {
        let updated: UserItem;
        if (action === 'lock') {
          updated = await usersApi.lockUser(id, {
            reason: options?.reason || 'Khóa bởi Quản trị viên',
            lockedUntil: options?.lockedUntil ?? null,
          });
        } else if (action === 'unlock') {
          updated = await usersApi.unlockUser(id);
        } else if (action === 'deactivate') {
          updated = await usersApi.deactivateUser(id);
        } else if (action === 'activate') {
          updated = await usersApi.activateUser(id);
        } else if (action === 'archive') {
          updated = await usersApi.archiveUser(id);
        } else {
          updated = await usersApi.restoreUser(id);
        }

        setBanner({
          type: 'success',
          message: `Đã chuyển trạng thái tài khoản "@${updated.username}" sang ${updated.statusName}.`,
        });
        await loadUsers(filter);
        await loadSelectedUserHistories(id);
        return true;
      } catch (err) {
        showError(err, 'Thao tác chuyển đổi trạng thái thất bại.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadSelectedUserHistories, loadUsers, showError],
  );

  const handleResetPassword = useCallback(
    async (
      id: number,
      payload: { newPassword?: string; useSuggestedPassword?: boolean; revokeSessions?: boolean },
    ) => {
      setSubmitting(true);
      setBanner(null);
      setLastPasswordResetResult(null);
      try {
        const result = await usersApi.resetUserPassword(id, payload);
        setLastPasswordResetResult(result);
        setBanner({
          type: 'success',
          message: `Đã đặt lại mật khẩu cho người dùng #${id} (thu hồi ${result.revokedSessionsCount} phiên).`,
        });
        await loadUsers(filter);
        return result;
      } catch (err) {
        showError(err, 'Đặt lại mật khẩu thất bại.');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadUsers, showError],
  );

  const handleResetMfa = useCallback(
    async (
      id: number,
      payload: { reason: string; verificationReference?: string; revokeSessions?: boolean },
    ) => {
      setSubmitting(true);
      setBanner(null);
      setLastMfaResetResult(null);
      try {
        const result = await usersApi.resetUserMfa(id, payload);
        setLastMfaResetResult(result);
        setBanner({
          type: 'success',
          message: `Đã reset MFA có kiểm soát cho người dùng #${id}.`,
        });
        await loadUsers(filter);
        return result;
      } catch (err) {
        showError(err, 'Reset MFA thất bại.');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadUsers, showError],
  );

  const handleRevokeSessions = useCallback(
    async (id: number, reason?: string) => {
      setSubmitting(true);
      setBanner(null);
      try {
        const result = await usersApi.revokeUserSessions(id, reason);
        setBanner({
          type: 'success',
          message: `Đã thu hồi ${result.revokedCount} phiên đăng nhập của người dùng #${id}.`,
        });
        return true;
      } catch (err) {
        showError(err, 'Thu hồi phiên thất bại.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [showError],
  );

  const triggerBrowserFileDownload = useCallback((fileRes: ExportUsersFileResponse) => {
    let blob: Blob;
    if (fileRes.format === 'xlsx' && fileRes.xlsxBase64) {
      const binaryStr = window.atob(fileRes.xlsxBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      blob = new Blob([bytes], {
        type:
          fileRes.contentType ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    } else {
      blob = new Blob(['\uFEFF' + (fileRes.csvContent || '')], {
        type: fileRes.contentType || 'text/csv;charset=utf-8;',
      });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileRes.fileName || `users-export.${fileRes.format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadTemplate = useCallback(
    async (format: 'csv' | 'xlsx') => {
      setSubmitting(true);
      try {
        const result = await usersApi.getImportTemplate(format);
        triggerBrowserFileDownload(result);
        setBanner({
          type: 'success',
          message: `Đã tải tệp mẫu nhập liệu (${result.fileName}).`,
        });
      } catch (err) {
        showError(err, 'Không thể tải tệp mẫu.');
      } finally {
        setSubmitting(false);
      }
    },
    [showError, triggerBrowserFileDownload],
  );

  const handleExportUsers = useCallback(
    async (format: 'csv' | 'xlsx', title?: string) => {
      setSubmitting(true);
      try {
        const result = await usersApi.exportUsers({
          ...filter,
          format,
          ...(title ? { title } : {}),
        });
        triggerBrowserFileDownload(result);
        setBanner({
          type: 'success',
          message: `Đã xuất ${result.totalExported} hồ sơ nhân sự ra tệp ${result.fileName}.`,
        });
      } catch (err) {
        showError(err, 'Xuất dữ liệu thất bại.');
      } finally {
        setSubmitting(false);
      }
    },
    [filter, showError, triggerBrowserFileDownload],
  );

  const handleBulkImport = useCallback(
    async (payload: {
      xlsxBase64?: string;
      csvContent?: string;
      defaultPassword?: string;
      skipDuplicates?: boolean;
    }) => {
      setSubmitting(true);
      setBanner(null);
      try {
        const result = await usersApi.bulkImportUsers(payload);
        setLastImportResult(result);
        setBanner({
          type: 'success',
          message: `Nhập hàng loạt hoàn tất: ${result.importedCount}/${result.totalRows} thành công (${result.skippedCount} bỏ qua, ${result.failedCount} lỗi).`,
        });
        await loadUsers(filter);
        return result;
      } catch (err) {
        showError(err, 'Nhập dữ liệu hàng loạt thất bại.');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadUsers, showError],
  );

  return {
    activeTab,
    setActiveTab,
    loading,
    submitting,
    banner,
    setBanner,
    users,
    pagination,
    filter,
    applyFilter,
    selectedUser,
    selectedUserId,
    setSelectedUserId,
    statusHistory,
    loginHistory,
    loadingHistory,
    roleOptions,
    organizationOptions,
    lastPasswordResetResult,
    lastMfaResetResult,
    lastImportResult,
    stats,
    refreshAll,
    handleCreateUser,
    handleUpdateUser,
    handleAssignRoles,
    handleAssignOrganizations,
    handleLifecycleAction,
    handleResetPassword,
    handleResetMfa,
    handleRevokeSessions,
    handleDownloadTemplate,
    handleExportUsers,
    handleBulkImport,
  };
}

