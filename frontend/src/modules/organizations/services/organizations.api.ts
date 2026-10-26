import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  BulkImportOrganizationsPayload,
  BulkImportOrganizationsResult,
  CreateOrganizationUnitPayload,
  ExportOrganizationsResponse,
  OrganizationMoveImpact,
  OrganizationStats,
  OrganizationTreeNode,
  OrganizationUnitItem,
  UpdateOrganizationUnitPayload,
} from '../types/organizations.types';

function resolveAuthHeaders(tokenOverride?: string): Record<string, string> {
  return tokenOverride ? { Authorization: `Bearer ${tokenOverride}` } : {};
}

function buildQueryString(params?: {
  search?: string;
  type?: number | string;
  status?: number | string;
  parentId?: number | string;
  managerId?: number | string;
  format?: 'csv' | 'xlsx';
  mode?: 'tree' | 'list';
}): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  if (params.search && params.search.trim()) {
    searchParams.set('search', params.search.trim());
  }
  if (params.type !== undefined && params.type !== '') {
    searchParams.set('type', String(params.type));
  }
  if (params.status !== undefined && params.status !== '') {
    searchParams.set('status', String(params.status));
  }
  if (params.parentId !== undefined && params.parentId !== '') {
    searchParams.set('parentId', String(params.parentId));
  }
  if (params.managerId !== undefined && params.managerId !== '') {
    searchParams.set('managerId', String(params.managerId));
  }
  if (params.format) {
    searchParams.set('format', params.format);
  }
  if (params.mode) {
    searchParams.set('mode', params.mode);
  }
  return searchParams.toString();
}

export const organizationsApi = {
  list: (
    query?: {
      search?: string;
      type?: number | string;
      status?: number | string;
      parentId?: number | string;
      managerId?: number | string;
    },
    accessToken?: string,
  ) =>
    fetchApi<OrganizationUnitItem[]>(API_ROUTES.ORGANIZATIONS.LIST(buildQueryString(query)), {
      headers: resolveAuthHeaders(accessToken),
    }),

  getTree: (
    query?: { search?: string; type?: number | string; status?: number | string },
    accessToken?: string,
  ) =>
    fetchApi<OrganizationTreeNode[]>(API_ROUTES.ORGANIZATIONS.TREE(buildQueryString(query)), {
      headers: resolveAuthHeaders(accessToken),
    }),

  getStats: (accessToken?: string) =>
    fetchApi<OrganizationStats>(API_ROUTES.ORGANIZATIONS.STATS, {
      headers: resolveAuthHeaders(accessToken),
    }),

  getById: (id: number, accessToken?: string) =>
    fetchApi<OrganizationUnitItem>(API_ROUTES.ORGANIZATIONS.DETAIL(id), {
      headers: resolveAuthHeaders(accessToken),
    }),

  create: (payload: CreateOrganizationUnitPayload, accessToken?: string) =>
    fetchApi<OrganizationUnitItem>(API_ROUTES.ORGANIZATIONS.CREATE, {
      method: 'POST',
      headers: resolveAuthHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  update: (id: number, payload: UpdateOrganizationUnitPayload, accessToken?: string) =>
    fetchApi<OrganizationUnitItem>(API_ROUTES.ORGANIZATIONS.UPDATE(id), {
      method: 'PATCH',
      headers: resolveAuthHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  assessMoveImpact: (id: number, newParentId: number | null, accessToken?: string) =>
    fetchApi<OrganizationMoveImpact>(API_ROUTES.ORGANIZATIONS.MOVE_IMPACT(id, newParentId), {
      headers: resolveAuthHeaders(accessToken),
    }),

  moveUnit: (
    id: number,
    payload: { newParentId: number | null; reason?: string },
    accessToken?: string,
  ) =>
    fetchApi<{ unit: OrganizationUnitItem; impact: OrganizationMoveImpact }>(
      API_ROUTES.ORGANIZATIONS.MOVE(id),
      {
        method: 'POST',
        headers: resolveAuthHeaders(accessToken),
        body: JSON.stringify(payload),
      },
    ),

  lockUnit: (id: number, reason?: string, accessToken?: string) =>
    fetchApi<OrganizationUnitItem>(API_ROUTES.ORGANIZATIONS.LOCK(id), {
      method: 'POST',
      headers: resolveAuthHeaders(accessToken),
      body: JSON.stringify({ reason }),
    }),

  unlockUnit: (id: number, reason?: string, accessToken?: string) =>
    fetchApi<OrganizationUnitItem>(API_ROUTES.ORGANIZATIONS.UNLOCK(id), {
      method: 'POST',
      headers: resolveAuthHeaders(accessToken),
      body: JSON.stringify({ reason }),
    }),

  exportUnits: (
    query?: {
      format?: 'csv' | 'xlsx';
      mode?: 'tree' | 'list';
      search?: string;
      type?: number | string;
      status?: number | string;
      parentId?: number | string;
    },
    accessToken?: string,
  ) =>
    fetchApi<ExportOrganizationsResponse>(
      API_ROUTES.ORGANIZATIONS.EXPORT(buildQueryString(query)),
      {
        headers: resolveAuthHeaders(accessToken),
      },
    ),

  downloadImportTemplate: (format: 'csv' | 'xlsx' = 'xlsx', accessToken?: string) =>
    fetchApi<ExportOrganizationsResponse>(API_ROUTES.ORGANIZATIONS.IMPORT_TEMPLATE(format), {
      headers: resolveAuthHeaders(accessToken),
    }),

  bulkImportUnits: (payload: BulkImportOrganizationsPayload, accessToken?: string) =>
    fetchApi<BulkImportOrganizationsResult>(API_ROUTES.ORGANIZATIONS.IMPORT, {
      method: 'POST',
      headers: resolveAuthHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  remove: (id: number, accessToken?: string) =>
    fetchApi<{ deleted: boolean; id: number }>(API_ROUTES.ORGANIZATIONS.DELETE(id), {
      method: 'DELETE',
      headers: resolveAuthHeaders(accessToken),
    }),
};
