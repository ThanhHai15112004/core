import { fetchApi, fetchApiWithMeta, IAM_ACCESS_TOKEN_KEY } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
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
  UserStatusHistoryItem,
} from '../types/users.types';
import type { UserStatusCode } from '../enum/users.enum';

function resolveAuthHeaders(tokenOverride?: string): Record<string, string> {
  const token =
    tokenOverride ??
    (() => {
      try {
        return window.localStorage.getItem(IAM_ACCESS_TOKEN_KEY) ?? '';
      } catch {
        return '';
      }
    })();
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  ) =>
    fetchApi<UserItem>(API_ROUTES.USERS.ASSIGN_ORGANIZATIONS(id), {
      method: 'PUT',
      headers: resolveAuthHeaders(),
      body: JSON.stringify({ organizationUnits }),
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

  getLoginHistory: (id: number) =>
    fetchApi<UserLoginHistoryItem[]>(API_ROUTES.USERS.LOGIN_HISTORY(id), {
      headers: resolveAuthHeaders(),
    }),

  getImportTemplate: (format: 'csv' | 'xlsx' = 'xlsx') =>
    fetchApi<ExportUsersFileResponse>(API_ROUTES.USERS.IMPORT_TEMPLATE(format), {
      headers: resolveAuthHeaders(),
    }),

  bulkImportUsers: (payload: {
    xlsxBase64?: string;
    csvContent?: string;
    defaultPassword?: string;
    skipDuplicates?: boolean;
  }) =>
    fetchApi<BulkImportUsersResult>(API_ROUTES.USERS.IMPORT, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  exportUsers: (filter?: ListUsersFilter & { format?: 'csv' | 'xlsx'; title?: string }) => {
    const qs = buildQueryString({
      q: filter?.q,
      status: filter?.status,
      roleId: filter?.roleId,
      organizationUnitId: filter?.organizationUnitId,
      includeArchived: filter?.includeArchived,
      mfaEnabled: filter?.mfaEnabled,
      format: filter?.format ?? 'xlsx',
      title: filter?.title,
    });
    return fetchApi<ExportUsersFileResponse>(API_ROUTES.USERS.EXPORT(qs), {
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
