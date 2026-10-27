import { useCallback, useEffect, useMemo, useState } from 'react';
import { USER_STATUS, USERS_TAB, type UsersTabId } from '../enum/users.enum';
import { usersApi } from '../services/users.api';
import type {
  AdminResetMfaResult,
  AdminResetPasswordResult,
  BulkImportUsersPayload,
  BulkImportUsersResult,
  CreateUserPayload,
  CreateUserReportSchedulePayload,
  ExportHistoryItem,
  ExportJobProgress,
  ExportUsersFileResponse,
  ImportHistoryItem,
  ImportJobProgress,
  ImportUsersPreviewResponse,
  ListUsersFilter,
  OrganizationOptionSummary,
  RegisteredReportDefinition,
  RegisteredSearchableEntity,
  RoleOptionSummary,
  RunUserReportPayload,
  SearchIndexLagReport,
  SearchQueryResult,
  SearchSyncHistoryItem,
  TemporaryDownloadFileResponse,
  UpdateUserPayload,
  UserItem,
  UserLoginHistoryItem,
  UserOrganizationAssignmentInput,
  UserOrganizationHistoryItem,
  UserReportExecutionResult,
  UserReportHistoryItem,
  UserReportScheduleItem,
  UsersPaginationMeta,
  UserStatusHistoryItem,
  UserSubordinatesOverview,
  ZeroResultKeywordStat,
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
  const [organizationHistory, setOrganizationHistory] = useState<UserOrganizationHistoryItem[]>([]);
  const [subordinatesOverview, setSubordinatesOverview] =
    useState<UserSubordinatesOverview | null>(null);
  const [loginHistory, setLoginHistory] = useState<UserLoginHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [roleOptions, setRoleOptions] = useState<RoleOptionSummary[]>([]);
  const [organizationOptions, setOrganizationOptions] = useState<OrganizationOptionSummary[]>([]);

  const [lastPasswordResetResult, setLastPasswordResetResult] =
    useState<AdminResetPasswordResult | null>(null);
  const [lastMfaResetResult, setLastMfaResetResult] = useState<AdminResetMfaResult | null>(null);
  const [lastImportResult, setLastImportResult] = useState<BulkImportUsersResult | null>(null);

  // Phase 8: Import & Export States (Mục 8.2 & 8.3)
  const [importPreview, setImportPreview] = useState<ImportUsersPreviewResponse | null>(null);
  const [importJobProgress, setImportJobProgress] = useState<ImportJobProgress | null>(null);
  const [importHistories, setImportHistories] = useState<ImportHistoryItem[]>([]);
  const [exportJobProgress, setExportJobProgress] = useState<ExportJobProgress | null>(null);
  const [exportHistories, setExportHistories] = useState<ExportHistoryItem[]>([]);

  // Phase 8: Reports & Dashboard States (Mục 8.4)
  const [availableReports, setAvailableReports] = useState<RegisteredReportDefinition[]>([]);
  const [lastReportResult, setLastReportResult] = useState<UserReportExecutionResult | null>(null);
  const [reportSchedules, setReportSchedules] = useState<UserReportScheduleItem[]>([]);
  const [reportHistories, setReportHistories] = useState<UserReportHistoryItem[]>([]);

  // Phase 8: Global Search States (Mục 8.5)
  const [searchableEntities, setSearchableEntities] = useState<RegisteredSearchableEntity[]>([]);
  const [searchResult, setSearchResult] = useState<SearchQueryResult | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<SearchSyncHistoryItem | null>(null);
  const [indexLagReport, setIndexLagReport] = useState<SearchIndexLagReport | null>(null);
  const [zeroResultKeywords, setZeroResultKeywords] = useState<ZeroResultKeywordStat[]>([]);

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
      const [statusRes, orgHistRes, subRes, loginRes] = await Promise.allSettled([
        usersApi.getStatusHistory(userId),
        usersApi.getOrganizationHistory(userId),
        usersApi.getSubordinates(userId),
        usersApi.getLoginHistory(userId),
      ]);
      setStatusHistory(
        statusRes.status === 'fulfilled' && Array.isArray(statusRes.value) ? statusRes.value : [],
      );
      setOrganizationHistory(
        orgHistRes.status === 'fulfilled' && Array.isArray(orgHistRes.value)
          ? orgHistRes.value
          : [],
      );
      setSubordinatesOverview(
        subRes.status === 'fulfilled' && subRes.value ? subRes.value : null,
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
      setOrganizationHistory([]);
      setSubordinatesOverview(null);
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
        await Promise.all([loadUsers(filter), loadSelectedUserHistories(id)]);
        return true;
      } catch (err) {
        showError(err, 'Cập nhật hồ sơ thất bại.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadSelectedUserHistories, loadUsers, showError],
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
      reason?: string | null,
    ): Promise<boolean> => {
      setSubmitting(true);
      setBanner(null);
      try {
        const updated = await usersApi.assignOrganizations(id, organizationUnits, reason);
        setBanner({
          type: 'success',
          message: `Đã cập nhật ${updated.organizationUnits.length} đơn vị công tác cho "@${updated.username}".`,
        });
        await Promise.all([loadUsers(filter), loadSelectedUserHistories(id)]);
        return true;
      } catch (err) {
        showError(err, 'Gán đơn vị công tác thất bại.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadSelectedUserHistories, loadUsers, showError],
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

  const triggerBrowserFileDownload = useCallback(
    (fileRes: ExportUsersFileResponse | TemporaryDownloadFileResponse) => {
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
      } else if (fileRes.format === 'pdf' && fileRes.pdfBase64) {
        const binaryStr = window.atob(fileRes.pdfBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        blob = new Blob([bytes], {
          type: fileRes.contentType || 'application/pdf',
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
    },
    [],
  );

  const loadImportExportHistories = useCallback(async () => {
    const [impRes, expRes] = await Promise.allSettled([
      usersApi.listImportHistories({ limit: 30 }),
      usersApi.listExportHistories({ includeExpired: true, limit: 30 }),
    ]);
    if (impRes.status === 'fulfilled' && Array.isArray(impRes.value)) {
      setImportHistories(impRes.value);
    }
    if (expRes.status === 'fulfilled' && Array.isArray(expRes.value)) {
      setExportHistories(expRes.value);
    }
  }, []);

  const loadReportsData = useCallback(async () => {
    const [defsRes, schRes, histRes] = await Promise.allSettled([
      usersApi.listAvailableReports(),
      usersApi.listReportSchedules(),
      usersApi.listReportHistories({ limit: 30 }),
    ]);
    if (defsRes.status === 'fulfilled' && Array.isArray(defsRes.value)) {
      setAvailableReports(defsRes.value);
    }
    if (schRes.status === 'fulfilled' && Array.isArray(schRes.value)) {
      setReportSchedules(schRes.value);
    }
    if (histRes.status === 'fulfilled' && Array.isArray(histRes.value)) {
      setReportHistories(histRes.value);
    }
  }, []);

  const loadSearchTelemetry = useCallback(async () => {
    const [entRes, lagRes, zeroRes] = await Promise.allSettled([
      usersApi.listSearchEntities(),
      usersApi.getSearchIndexLag(),
      usersApi.listZeroResultKeywords({ limit: 30 }),
    ]);
    if (entRes.status === 'fulfilled' && Array.isArray(entRes.value)) {
      setSearchableEntities(entRes.value);
    }
    if (lagRes.status === 'fulfilled' && lagRes.value) {
      setIndexLagReport(lagRes.value);
    }
    if (zeroRes.status === 'fulfilled' && Array.isArray(zeroRes.value)) {
      setZeroResultKeywords(zeroRes.value);
    }
  }, []);

  useEffect(() => {
    if (activeTab === USERS_TAB.BULK_IMPORT_EXPORT) {
      void loadImportExportHistories();
    } else if (activeTab === USERS_TAB.REPORTS_DASHBOARD) {
      void loadReportsData();
    } else if (activeTab === USERS_TAB.GLOBAL_SEARCH) {
      void loadSearchTelemetry();
    }
  }, [activeTab, loadImportExportHistories, loadReportsData, loadSearchTelemetry]);

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
    async (
      format: 'csv' | 'xlsx' | 'pdf',
      title?: string,
      options?: { async?: boolean; notifyOnComplete?: boolean; ttlSeconds?: number },
    ) => {
      setSubmitting(true);
      try {
        const result = await usersApi.exportUsers({
          ...filter,
          format,
          ...(title ? { title } : {}),
          ...(options?.async !== undefined ? { async: options.async } : {}),
          ...(options?.notifyOnComplete !== undefined
            ? { notifyOnComplete: options.notifyOnComplete }
            : {}),
          ...(options?.ttlSeconds !== undefined ? { ttlSeconds: options.ttlSeconds } : {}),
        });
        if (result.status === 'QUEUED' && result.jobId) {
          setBanner({
            type: 'success',
            message: `Đã đẩy công việc Export (${format.toUpperCase()}) vào Queue (Job ID: ${result.jobId}).`,
          });
          const prog = await usersApi.getExportJobProgress(result.jobId);
          setExportJobProgress(prog);
        } else {
          triggerBrowserFileDownload(result);
          setBanner({
            type: 'success',
            message: `Đã xuất ${result.totalExported} hồ sơ nhân sự ra tệp ${result.fileName}.`,
          });
        }
        await loadImportExportHistories();
      } catch (err) {
        showError(err, 'Xuất dữ liệu thất bại.');
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadImportExportHistories, showError, triggerBrowserFileDownload],
  );

  const handlePreviewImport = useCallback(
    async (payload: BulkImportUsersPayload) => {
      setSubmitting(true);
      setBanner(null);
      try {
        const preview = await usersApi.previewBulkImportUsers(payload);
        setImportPreview(preview);
        setBanner({
          type: 'success',
          message: `Xem trước hoàn tất: ${preview.validRowsCount}/${preview.totalRows} dòng hợp lệ (${preview.willCreateCount} tạo mới, ${preview.willUpdateCount} cập nhật, ${preview.invalidRowsCount} lỗi).`,
        });
        return preview;
      } catch (err) {
        showError(err, 'Xem trước dữ liệu Import thất bại.');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [showError],
  );

  const handleBulkImport = useCallback(
    async (payload: BulkImportUsersPayload) => {
      setSubmitting(true);
      setBanner(null);
      try {
        const result = await usersApi.bulkImportUsers(payload);
        setLastImportResult(result);
        if (result.jobId) {
          try {
            const prog = await usersApi.getImportJobProgress(result.jobId);
            setImportJobProgress(prog);
          } catch {
            // ignore progress lookup error if job is transient
          }
        }
        setBanner({
          type: 'success',
          message:
            result.status === 'QUEUED'
              ? `Đã đẩy phiên Import vào Queue (Job ID: ${result.jobId}).`
              : `Nhập hàng loạt hoàn tất: ${result.importedCount} tạo mới, ${result.updatedCount ?? 0} cập nhật, ${result.skippedCount} bỏ qua, ${result.failedCount} lỗi.`,
        });
        await Promise.all([loadUsers(filter), loadImportExportHistories()]);
        return result;
      } catch (err) {
        showError(err, 'Nhập dữ liệu hàng loạt thất bại.');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [filter, loadImportExportHistories, loadUsers, showError],
  );

  const handleRefreshImportJobProgress = useCallback(
    async (jobId: string) => {
      try {
        const prog = await usersApi.getImportJobProgress(jobId);
        setImportJobProgress(prog);
      } catch (err) {
        showError(err, 'Không tìm thấy tiến độ Import Job.');
      }
    },
    [showError],
  );

  const handleRefreshExportJobProgress = useCallback(
    async (jobId: string) => {
      try {
        const prog = await usersApi.getExportJobProgress(jobId);
        setExportJobProgress(prog);
      } catch (err) {
        showError(err, 'Không tìm thấy tiến độ Export Job.');
      }
    },
    [showError],
  );

  const handleDownloadTemporaryExport = useCallback(
    async (token: string) => {
      setSubmitting(true);
      try {
        const fileRes = await usersApi.downloadTemporaryExport(token);
        triggerBrowserFileDownload(fileRes);
        setBanner({
          type: 'success',
          message: `Đã tải tệp tạm thời "${fileRes.fileName}".`,
        });
      } catch (err) {
        showError(err, 'Tệp tạm thời đã hết hạn hoặc không hợp lệ.');
      } finally {
        setSubmitting(false);
      }
    },
    [showError, triggerBrowserFileDownload],
  );

  const handleRunReport = useCallback(
    async (payload: RunUserReportPayload) => {
      setSubmitting(true);
      setBanner(null);
      try {
        const res = await usersApi.runReport(payload);
        setLastReportResult(res);
        setBanner({
          type: 'success',
          message: `Đã chạy báo cáo "${res.reportName}" (${res.totalRecords} bản ghi • Nguồn: ${res.dataSourceUsed}).`,
        });
        await loadReportsData();
        return res;
      } catch (err) {
        showError(err, 'Thực thi báo cáo thất bại.');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [loadReportsData, showError],
  );

  const handleCreateReportSchedule = useCallback(
    async (payload: CreateUserReportSchedulePayload) => {
      setSubmitting(true);
      setBanner(null);
      try {
        const created = await usersApi.createReportSchedule(payload);
        setBanner({
          type: 'success',
          message: `Đã đăng ký lịch gửi báo cáo "${created.name}" (${created.frequency}).`,
        });
        await loadReportsData();
        return created;
      } catch (err) {
        showError(err, 'Tạo lịch báo cáo thất bại.');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [loadReportsData, showError],
  );

  const handleTriggerDueReportSchedules = useCallback(async () => {
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await usersApi.triggerDueReportSchedules();
      setBanner({
        type: 'success',
        message: `Đã kích hoạt ${res.triggeredCount} lịch báo cáo đến hạn.`,
      });
      await loadReportsData();
    } catch (err) {
      showError(err, 'Kích hoạt lịch báo cáo thất bại.');
    } finally {
      setSubmitting(false);
    }
  }, [loadReportsData, showError]);

  const handleDownloadTemporaryReport = useCallback(
    async (token: string) => {
      setSubmitting(true);
      try {
        const fileRes = await usersApi.downloadTemporaryReport(token);
        triggerBrowserFileDownload(fileRes);
        setBanner({
          type: 'success',
          message: `Đã tải tệp báo cáo tạm thời "${fileRes.fileName}".`,
        });
      } catch (err) {
        showError(err, 'Tệp báo cáo tạm thời đã hết hạn hoặc không tồn tại.');
      } finally {
        setSubmitting(false);
      }
    },
    [showError, triggerBrowserFileDownload],
  );

  const handleSearchGlobal = useCallback(
    async (searchFilter: {
      keyword: string;
      entityCode?: string;
      status?: number | '';
      organizationUnitId?: number | '';
      includeStale?: boolean;
    }) => {
      setSubmitting(true);
      try {
        const res = await usersApi.searchGlobal(searchFilter);
        setSearchResult(res);
        await loadSearchTelemetry();
      } catch (err) {
        showError(err, 'Truy vấn tìm kiếm toàn hệ thống thất bại.');
      } finally {
        setSubmitting(false);
      }
    },
    [loadSearchTelemetry, showError],
  );

  const handleSyncSearchIndex = useCallback(
    async (options: { async?: boolean }) => {
      setSubmitting(true);
      try {
        const res = await usersApi.syncSearchIndex(options);
        setLastSyncResult(res);
        setBanner({
          type: 'success',
          message:
            res.executionMode === 'QUEUE'
              ? `Đã đẩy yêu cầu đồng bộ Search Index vào Queue (Job ID: ${res.jobId}).`
              : `Đã đồng bộ ${res.indexedCount} hồ sơ nhân sự vào Search Index (${res.driverUsed}).`,
        });
        await loadSearchTelemetry();
      } catch (err) {
        showError(err, 'Đồng bộ Search Index thất bại.');
      } finally {
        setSubmitting(false);
      }
    },
    [loadSearchTelemetry, showError],
  );

  const handleRebuildSearchIndex = useCallback(
    async (options: { module?: string; entityType?: string; async?: boolean }) => {
      setSubmitting(true);
      try {
        const res = await usersApi.rebuildSearchIndex(options);
        setLastSyncResult(res);
        setBanner({
          type: 'success',
          message:
            res.executionMode === 'QUEUE'
              ? `Đã đẩy yêu cầu Rebuild Search Index vào Queue (Job ID: ${res.jobId}).`
              : `Đã tạo lại toàn bộ Search Index (${res.indexedCount} tài liệu được lập chỉ mục).`,
        });
        await loadSearchTelemetry();
      } catch (err) {
        showError(err, 'Tạo lại Search Index thất bại.');
      } finally {
        setSubmitting(false);
      }
    },
    [loadSearchTelemetry, showError],
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
    organizationHistory,
    subordinatesOverview,
    loginHistory,
    loadingHistory,
    roleOptions,
    organizationOptions,
    lastPasswordResetResult,
    lastMfaResetResult,
    lastImportResult,
    importPreview,
    importJobProgress,
    importHistories,
    exportJobProgress,
    exportHistories,
    availableReports,
    lastReportResult,
    reportSchedules,
    reportHistories,
    searchableEntities,
    searchResult,
    lastSyncResult,
    indexLagReport,
    zeroResultKeywords,
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
    handlePreviewImport,
    handleBulkImport,
    handleRefreshImportJobProgress,
    handleRefreshExportJobProgress,
    handleDownloadTemporaryExport,
    loadImportExportHistories,
    handleRunReport,
    handleCreateReportSchedule,
    handleTriggerDueReportSchedules,
    handleDownloadTemporaryReport,
    loadReportsData,
    handleSearchGlobal,
    handleSyncSearchIndex,
    handleRebuildSearchIndex,
    loadSearchTelemetry,
  };
}

