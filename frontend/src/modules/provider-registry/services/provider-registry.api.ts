import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  ProviderCatalogView,
  ProviderConfigHistoryItem,
  ProviderDashboardView,
  ProviderHealthCheckItem,
  ProviderRegistryEntryItem,
  ProviderResolvePreviewResult,
  ProviderUnitAssignmentItem,
} from '../types/provider-registry.types';

export const providerRegistryApi = {
  getCatalog: (): Promise<ProviderCatalogView> =>
    fetchApi<ProviderCatalogView>(API_ROUTES.PROVIDER_REGISTRY.CATALOG),

  getDashboard: (qs = ''): Promise<ProviderDashboardView> =>
    fetchApi<ProviderDashboardView>(API_ROUTES.PROVIDER_REGISTRY.DASHBOARD(qs)),

  listProviders: (qs = '') =>
    fetchApiWithMeta<ProviderRegistryEntryItem[]>(API_ROUTES.PROVIDER_REGISTRY.PROVIDERS(qs)),

  createProvider: (payload: Record<string, unknown>): Promise<ProviderRegistryEntryItem> =>
    fetchApi<ProviderRegistryEntryItem>(API_ROUTES.PROVIDER_REGISTRY.PROVIDERS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProvider: (
    id: number | string,
    payload: Record<string, unknown>,
  ): Promise<ProviderRegistryEntryItem> =>
    fetchApi<ProviderRegistryEntryItem>(API_ROUTES.PROVIDER_REGISTRY.PROVIDER_BY_ID(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteProvider: (id: number | string): Promise<{ deleted: true; id: number }> =>
    fetchApi<{ deleted: true; id: number }>(API_ROUTES.PROVIDER_REGISTRY.PROVIDER_BY_ID(id), {
      method: 'DELETE',
    }),

  setPrimary: (id: number | string, reason?: string): Promise<ProviderRegistryEntryItem> =>
    fetchApi<ProviderRegistryEntryItem>(API_ROUTES.PROVIDER_REGISTRY.PROVIDER_SET_PRIMARY(id), {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  pauseProvider: (id: number | string, reason?: string): Promise<ProviderRegistryEntryItem> =>
    fetchApi<ProviderRegistryEntryItem>(API_ROUTES.PROVIDER_REGISTRY.PROVIDER_PAUSE(id), {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  resumeProvider: (id: number | string, reason?: string): Promise<ProviderRegistryEntryItem> =>
    fetchApi<ProviderRegistryEntryItem>(API_ROUTES.PROVIDER_REGISTRY.PROVIDER_RESUME(id), {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  checkProviderHealth: (id: number | string): Promise<ProviderHealthCheckItem> =>
    fetchApi<ProviderHealthCheckItem>(API_ROUTES.PROVIDER_REGISTRY.PROVIDER_HEALTH_CHECK(id), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  checkAllProvidersHealth: (providerType?: string): Promise<ProviderHealthCheckItem[]> =>
    fetchApi<ProviderHealthCheckItem[]>(API_ROUTES.PROVIDER_REGISTRY.HEALTH_CHECK_ALL, {
      method: 'POST',
      body: JSON.stringify(providerType ? { providerType } : {}),
    }),

  listHealthChecks: (id: number | string, qs = '') =>
    fetchApiWithMeta<ProviderHealthCheckItem[]>(
      API_ROUTES.PROVIDER_REGISTRY.PROVIDER_HEALTH_CHECKS(id, qs),
    ),

  resolvePreview: (payload: Record<string, unknown>): Promise<ProviderResolvePreviewResult> =>
    fetchApi<ProviderResolvePreviewResult>(API_ROUTES.PROVIDER_REGISTRY.RESOLVE, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listUnitAssignments: (qs = '') =>
    fetchApiWithMeta<ProviderUnitAssignmentItem[]>(
      API_ROUTES.PROVIDER_REGISTRY.UNIT_ASSIGNMENTS(qs),
    ),

  upsertUnitAssignment: (payload: Record<string, unknown>): Promise<ProviderUnitAssignmentItem> =>
    fetchApi<ProviderUnitAssignmentItem>(API_ROUTES.PROVIDER_REGISTRY.UNIT_ASSIGNMENTS(), {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteUnitAssignment: (id: number | string): Promise<{ deleted: true; id: number }> =>
    fetchApi<{ deleted: true; id: number }>(
      API_ROUTES.PROVIDER_REGISTRY.UNIT_ASSIGNMENT_BY_ID(id),
      {
        method: 'DELETE',
      },
    ),

  listHistories: (qs = '') =>
    fetchApiWithMeta<ProviderConfigHistoryItem[]>(API_ROUTES.PROVIDER_REGISTRY.HISTORIES(qs)),
};
