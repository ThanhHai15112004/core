import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
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
  TriggeredReportScheduleResult,
  UpdateUserPayload,
  UserItem,
  UserLoginHistoryItem,
  UserOrganizationAssignmentInput,
  UserOrganizationHistoryItem,
  UserReportExecutionResult,
  UserReportHistoryItem,
  UserReportScheduleItem,
  UserStatusHistoryItem,
  UserSubordinatesOverview,
  ZeroResultKeywordStat,
} from '../types/users.types';
import type { UserStatusCode } from '../enum/users.enum';

function resolveAuthHeaders(tokenOverride?: string): Record<string, string> {
  return tokenOverride ? { Authorization: `Bearer ${tokenOverride}` } : {};
}

function buildQueryString(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') {
      sp.set(k, String(v));
    }
  }
  return sp.toString();
}

export const usersApi = {
  listUsers: (filter?: ListUsersFilter) => {
    const qs = buildQueryString({
      q: filter?.q,
      status: filter?.status,
      roleId: filter?.roleId,
      organizationUnitId: filter?.organizationUnitId,
      includeArchived: filter?.includeArchived,
      mfaEnabled: filter?.mfaEnabled,
      page: filter?.page ?? 1,
      limit: filter?.limit ?? 20,
    });
    return fetchApiWithMeta<UserItem[]>(API_ROUTES.USERS.LIST(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  getUserById: (id: number) =>
    fetchApi<UserItem>(API_ROUTES.USERS.DETAIL(id), {
      headers: resolveAuthHeaders(),
    }),

  createUser: (payload: CreateUserPayload) =>
    fetchApi<UserItem>(API_ROUTES.USERS.CREATE, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  updateUser: (id: number, payload: UpdateUserPayload) =>
    fetchApi<UserItem>(API_ROUTES.USERS.UPDATE(id), {
      method: 'PATCH',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  assignRoles: (id: number, roleIds: readonly number[]) =>
    fetchApi<UserItem>(API_ROUTES.USERS.ASSIGN_ROLES(id), {
      method: 'PUT',
      headers: resolveAuthHeaders(),
      body: JSON.stringify({ roleIds }),
    }),

  assignOrganizations: (
    id: number,
    organizationUnits: readonly UserOrganizationAssignmentInput[],
    reason?: string | null,
  ) =>
    fetchApi<UserItem>(API_ROUTES.USERS.ASSIGN_ORGANIZATIONS(id), {
      method: 'PUT',
      headers: resolveAuthHeaders(),
      body: JSON.stringify({
        organizationUnits,
        ...(reason && reason.trim() ? { reason: reason.trim() } : {}),
      }),
    }),

  lockUser: (id: number, payload: { reason: string; lockedUntil?: string | null }) =>
    fetchApi<UserItem>(API_ROUTES.USERS.LOCK(id), {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  unlockUser: (id: number) =>
    fetchApi<UserItem>(API_ROUTES.USERS.UNLOCK(id), {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify({}),
    }),

  deactivateUser: (id: number) =>
    fetchApi<UserItem>(API_ROUTES.USERS.DEACTIVATE(id), {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify({}),
    }),

  activateUser: (id: number) =>
    fetchApi<UserItem>(API_ROUTES.USERS.ACTIVATE(id), {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify({}),
    }),

  archiveUser: (id: number) =>
    fetchApi<UserItem>(API_ROUTES.USERS.ARCHIVE(id), {
      method: 'DELETE',
      headers: resolveAuthHeaders(),
    }),

  restoreUser: (id: number) =>
    fetchApi<UserItem>(API_ROUTES.USERS.RESTORE(id), {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify({}),
    }),

  changeUserStatus: (
    id: number,
    payload: { status: UserStatusCode; reason?: string | null; lockedUntil?: string | null },
  ) =>
    fetchApi<UserItem>(API_ROUTES.USERS.STATUS(id), {
      method: 'PUT',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  resetUserPassword: (
    id: number,
    payload: { newPassword?: string; useSuggestedPassword?: boolean; revokeSessions?: boolean },
  ) =>
    fetchApi<AdminResetPasswordResult>(API_ROUTES.USERS.RESET_PASSWORD(id), {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  resetUserMfa: (
    id: number,
    payload: { reason: string; verificationReference?: string; revokeSessions?: boolean },
  ) =>
    fetchApi<AdminResetMfaResult>(API_ROUTES.USERS.RESET_MFA(id), {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  revokeUserSessions: (id: number, reason?: string) =>
    fetchApi<{
      revoked: true;
      userId: number;
      revokedCount: number;
      revokedSessionsCount?: number;
      reason?: string;
    }>(API_ROUTES.USERS.REVOKE_SESSIONS(id), {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  getStatusHistory: (id: number) =>
    fetchApi<UserStatusHistoryItem[]>(API_ROUTES.USERS.STATUS_HISTORY(id), {
      headers: resolveAuthHeaders(),
    }),

  getOrganizationHistory: (id: number) =>
    fetchApi<UserOrganizationHistoryItem[]>(API_ROUTES.USERS.ORGANIZATION_HISTORY(id), {
      headers: resolveAuthHeaders(),
    }),

  getSubordinates: (
    id: number,
    query?: { directOnly?: boolean; includeTemporary?: boolean },
  ) => {
    const qs = buildQueryString({
      directOnly: query?.directOnly,
      includeTemporary: query?.includeTemporary,
    });
    return fetchApi<UserSubordinatesOverview>(API_ROUTES.USERS.SUBORDINATES(id, qs), {
      headers: resolveAuthHeaders(),
    });
  },

  getLoginHistory: (id: number) =>
    fetchApi<UserLoginHistoryItem[]>(API_ROUTES.USERS.LOGIN_HISTORY(id), {
      headers: resolveAuthHeaders(),
    }),

  getImportTemplate: (format: 'csv' | 'xlsx' = 'xlsx') =>
    fetchApi<ExportUsersFileResponse>(API_ROUTES.USERS.IMPORT_TEMPLATE(format), {
      headers: resolveAuthHeaders(),
    }),

  previewBulkImportUsers: (payload: BulkImportUsersPayload) =>
    fetchApi<ImportUsersPreviewResponse>(API_ROUTES.USERS.IMPORT_PREVIEW, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  bulkImportUsers: (payload: BulkImportUsersPayload) =>
    fetchApi<BulkImportUsersResult>(API_ROUTES.USERS.IMPORT, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  listImportHistories: (filter?: { status?: string; limit?: number }) => {
    const qs = buildQueryString({
      status: filter?.status,
      limit: filter?.limit ?? 30,
    });
    return fetchApi<ImportHistoryItem[]>(API_ROUTES.USERS.IMPORT_HISTORIES(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  getImportJobProgress: (jobId: string) =>
    fetchApi<ImportJobProgress>(API_ROUTES.USERS.IMPORT_JOB_PROGRESS(jobId), {
      headers: resolveAuthHeaders(),
    }),

  exportUsers: (
    filter?: ListUsersFilter & {
      format?: 'csv' | 'xlsx' | 'pdf';
      title?: string;
      async?: boolean;
      notifyOnComplete?: boolean;
      ttlSeconds?: number;
    },
  ) => {
    const qs = buildQueryString({
      q: filter?.q,
      status: filter?.status,
      roleId: filter?.roleId,
      organizationUnitId: filter?.organizationUnitId,
      includeArchived: filter?.includeArchived,
      mfaEnabled: filter?.mfaEnabled,
      format: filter?.format ?? 'xlsx',
      title: filter?.title,
      async: filter?.async,
      notifyOnComplete: filter?.notifyOnComplete,
      ttlSeconds: filter?.ttlSeconds,
    });
    return fetchApi<ExportUsersFileResponse>(API_ROUTES.USERS.EXPORT(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  listExportHistories: (filter?: {
    format?: string;
    status?: string;
    includeExpired?: boolean;
    limit?: number;
  }) => {
    const qs = buildQueryString({
      format: filter?.format,
      status: filter?.status,
      includeExpired: filter?.includeExpired ?? true,
      limit: filter?.limit ?? 30,
    });
    return fetchApi<ExportHistoryItem[]>(API_ROUTES.USERS.EXPORT_HISTORIES(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  getExportJobProgress: (jobId: string) =>
    fetchApi<ExportJobProgress>(API_ROUTES.USERS.EXPORT_JOB_PROGRESS(jobId), {
      headers: resolveAuthHeaders(),
    }),

  downloadTemporaryExport: (token: string) =>
    fetchApi<TemporaryDownloadFileResponse>(API_ROUTES.USERS.EXPORT_DOWNLOAD_BY_TOKEN(token), {
      headers: resolveAuthHeaders(),
    }),

  listAvailableReports: () =>
    fetchApi<RegisteredReportDefinition[]>(API_ROUTES.USERS.REPORTS, {
      headers: resolveAuthHeaders(),
    }),

  runReport: (payload: RunUserReportPayload) =>
    fetchApi<UserReportExecutionResult>(API_ROUTES.USERS.REPORTS_RUN, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  listReportSchedules: (filter?: {
    reportCode?: string;
    frequency?: string;
    isActive?: boolean;
  }) => {
    const qs = buildQueryString({
      reportCode: filter?.reportCode,
      frequency: filter?.frequency,
      isActive: filter?.isActive,
    });
    return fetchApi<UserReportScheduleItem[]>(API_ROUTES.USERS.REPORTS_SCHEDULES(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  createReportSchedule: (payload: CreateUserReportSchedulePayload) =>
    fetchApi<UserReportScheduleItem>(API_ROUTES.USERS.REPORTS_SCHEDULES(''), {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  triggerDueReportSchedules: () =>
    fetchApi<TriggeredReportScheduleResult>(API_ROUTES.USERS.REPORTS_SCHEDULES_TRIGGER_DUE, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify({}),
    }),

  listReportHistories: (filter?: {
    reportCode?: string;
    status?: string;
    executionMode?: string;
    limit?: number;
  }) => {
    const qs = buildQueryString({
      reportCode: filter?.reportCode,
      status: filter?.status,
      executionMode: filter?.executionMode,
      limit: filter?.limit ?? 30,
    });
    return fetchApi<UserReportHistoryItem[]>(API_ROUTES.USERS.REPORTS_HISTORIES(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  downloadTemporaryReport: (token: string) =>
    fetchApi<TemporaryDownloadFileResponse>(API_ROUTES.USERS.REPORTS_DOWNLOAD_BY_TOKEN(token), {
      headers: resolveAuthHeaders(),
    }),

  searchGlobal: (filter: {
    keyword: string;
    module?: string;
    entityType?: string;
    entityCode?: string;
    status?: number | '';
    organizationUnitId?: number | '';
    includeStale?: boolean;
    page?: number;
    limit?: number;
  }) => {
    const qs = buildQueryString({
      keyword: filter.keyword,
      module: filter.module,
      entityType: filter.entityType,
      entityCode: filter.entityCode,
      status: filter.status,
      organizationUnitId: filter.organizationUnitId,
      includeStale: filter.includeStale,
      page: filter.page ?? 1,
      limit: filter.limit ?? 20,
    });
    return fetchApi<SearchQueryResult>(API_ROUTES.USERS.SEARCH(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  listSearchEntities: () =>
    fetchApi<RegisteredSearchableEntity[]>(API_ROUTES.USERS.SEARCH_ENTITIES, {
      headers: resolveAuthHeaders(),
    }),

  syncSearchIndex: (payload: { userIds?: readonly number[]; async?: boolean }) =>
    fetchApi<SearchSyncHistoryItem>(API_ROUTES.USERS.SEARCH_SYNC, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  rebuildSearchIndex: (payload: {
    module?: string;
    entityType?: string;
    entityCode?: string;
    async?: boolean;
  }) =>
    fetchApi<SearchSyncHistoryItem>(API_ROUTES.USERS.SEARCH_REBUILD, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  getSearchIndexLag: (filter?: {
    module?: string;
    entityType?: string;
    staleOnly?: boolean;
  }) => {
    const qs = buildQueryString({
      module: filter?.module,
      entityType: filter?.entityType,
      staleOnly: filter?.staleOnly,
    });
    return fetchApi<SearchIndexLagReport>(API_ROUTES.USERS.SEARCH_LAG(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  listZeroResultKeywords: (filter?: { module?: string; entityType?: string; limit?: number }) => {
    const qs = buildQueryString({
      module: filter?.module,
      entityType: filter?.entityType,
      limit: filter?.limit ?? 30,
    });
    return fetchApi<ZeroResultKeywordStat[]>(API_ROUTES.USERS.SEARCH_ZERO_RESULTS(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  listRoleOptions: () =>
    fetchApi<RoleOptionSummary[]>(API_ROUTES.ROLES.LIST(''), {
      headers: resolveAuthHeaders(),
    }),

  listOrganizationOptions: () =>
    fetchApi<OrganizationOptionSummary[]>(API_ROUTES.ORGANIZATIONS.LIST('limit=200'), {
      headers: resolveAuthHeaders(),
    }),
};
