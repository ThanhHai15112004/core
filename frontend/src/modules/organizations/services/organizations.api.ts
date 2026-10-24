import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  CreateOrganizationUnitPayload,
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
  return searchParams.toString();
}

export const organizationsApi = {
  list: (
    query?: { search?: string; type?: number | string; status?: number | string; parentId?: number | string },
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

  remove: (id: number, accessToken?: string) =>
    fetchApi<{ deleted: boolean; id: number }>(API_ROUTES.ORGANIZATIONS.DELETE(id), {
      method: 'DELETE',
      headers: resolveAuthHeaders(accessToken),
    }),
};

