import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  AuditLogItem,
  AuditLogPaginatedResponse,
  CloneRolePayload,
  CreateRolePayload,
  CustomScopeRuleItem,
  EffectiveDataScopeOverview,
  OrphanedPermissionWarning,
  PermissionCatalogItem,
  PermissionFunctionalGroup,
  RegisterCustomScopeRulePayload,
  RoleAssignedUser,
  RoleItem,
  RolePermissionMatrix,
  SecurityAlertItem,
  SecurityEventItem,
  SyncPermissionsResult,
  UpdateRolePayload,
} from '../types/roles.types';

function resolveAuthHeaders(tokenOverride?: string): Record<string, string> {
  return tokenOverride ? { Authorization: `Bearer ${tokenOverride}` } : {};
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') {
      sp.set(k, String(v));
    }
  }
  return sp.toString();
}

export const rolesApi = {
  listRoles: (params?: { search?: string; status?: number; dataScope?: number }) => {
    const qs = buildQueryString(params ?? {});
    return fetchApi<RoleItem[]>(API_ROUTES.ROLES.LIST(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  getRoleById: (id: number) =>
    fetchApi<RoleItem>(API_ROUTES.ROLES.DETAIL(id), {
      headers: resolveAuthHeaders(),
    }),

  createRole: (payload: CreateRolePayload) =>
    fetchApi<RoleItem>(API_ROUTES.ROLES.CREATE, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  updateRole: (id: number, payload: UpdateRolePayload) =>
    fetchApi<RoleItem>(API_ROUTES.ROLES.UPDATE(id), {
      method: 'PATCH',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  cloneRole: (id: number, payload: CloneRolePayload) =>
    fetchApi<RoleItem>(API_ROUTES.ROLES.CLONE(id), {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  setRolePermissions: (id: number, permissions: readonly string[]) =>
    fetchApi<RoleItem>(API_ROUTES.ROLES.SET_PERMISSIONS(id), {
      method: 'PUT',
      headers: resolveAuthHeaders(),
      body: JSON.stringify({ permissions }),
    }),

  deleteRole: (id: number) =>
    fetchApi<{ deleted: true; id: number }>(API_ROUTES.ROLES.DELETE(id), {
      method: 'DELETE',
      headers: resolveAuthHeaders(),
    }),

  listAssignedUsers: (roleId: number) =>
    fetchApi<RoleAssignedUser[]>(API_ROUTES.ROLES.USERS(roleId), {
      headers: resolveAuthHeaders(),
    }),

  listPermissionsCatalog: () =>
    fetchApi<PermissionCatalogItem[]>(API_ROUTES.ROLES.PERMISSIONS, {
      headers: resolveAuthHeaders(),
    }),

  listPermissionsGrouped: () =>
    fetchApi<PermissionFunctionalGroup[]>(API_ROUTES.ROLES.PERMISSIONS_GROUPED, {
      headers: resolveAuthHeaders(),
    }),

  syncPermissions: () =>
    fetchApi<SyncPermissionsResult>(API_ROUTES.ROLES.PERMISSIONS_SYNC, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify({}),
    }),

  listOrphanedPermissions: () =>
    fetchApi<OrphanedPermissionWarning[]>(API_ROUTES.ROLES.PERMISSIONS_ORPHANS, {
      headers: resolveAuthHeaders(),
    }),

  getPermissionMatrix: () =>
    fetchApi<RolePermissionMatrix>(API_ROUTES.ROLES.PERMISSIONS_MATRIX, {
      headers: resolveAuthHeaders(),
    }),

  getMyEffectiveDataScope: () =>
    fetchApi<EffectiveDataScopeOverview>(API_ROUTES.ROLES.DATA_SCOPES_ME, {
      headers: resolveAuthHeaders(),
    }),

  listCustomScopeRules: () =>
    fetchApi<CustomScopeRuleItem[]>(API_ROUTES.ROLES.DATA_SCOPES_RULES, {
      headers: resolveAuthHeaders(),
    }),

  registerCustomScopeRule: (payload: RegisterCustomScopeRulePayload) =>
    fetchApi<CustomScopeRuleItem>(API_ROUTES.ROLES.DATA_SCOPES_RULES, {
      method: 'POST',
      headers: resolveAuthHeaders(),
      body: JSON.stringify(payload),
    }),

  listAuditLogs: (params?: {
    page?: number;
    limit?: number;
    q?: string;
    module?: string;
    action?: string;
    actorType?: number;
    sortOrder?: 'ASC' | 'DESC';
  }) => {
    const qs = buildQueryString(params ?? {});
    return fetchApi<AuditLogPaginatedResponse>(API_ROUTES.ROLES.AUDIT_LOGS(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  getAuditLogById: (id: number) =>
    fetchApi<AuditLogItem>(API_ROUTES.ROLES.AUDIT_LOG_DETAIL(id), {
      headers: resolveAuthHeaders(),
    }),

  listSecurityEvents: (params?: { eventType?: string; limit?: number }) => {
    const qs = buildQueryString(params ?? {});
    return fetchApi<SecurityEventItem[]>(API_ROUTES.ROLES.SECURITY_EVENTS(qs), {
      headers: resolveAuthHeaders(),
    });
  },

  listSecurityAlerts: (params?: {
    anomalyType?: string;
    severity?: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
    limit?: number;
  }) => {
    const qs = buildQueryString(params ?? {});
    return fetchApi<SecurityAlertItem[]>(API_ROUTES.ROLES.SECURITY_ALERTS(qs), {
      headers: resolveAuthHeaders(),
    });
  },
};

