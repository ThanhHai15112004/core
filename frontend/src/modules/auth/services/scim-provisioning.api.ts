import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  ScimClientCreatedResult,
  ScimClientItem,
  ScimDeprovisionMode,
  ScimGroupItem,
  ScimReconciliationMode,
  ScimReconciliationRunItem,
  ScimSyncLogItem,
  ScimUserLinkItem,
} from '../types/scim-provisioning.types';

function authHeaders(accessToken?: string): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export interface UpsertScimClientPayload {
  readonly code?: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status?: 1 | 2;
  readonly allowedIps?: readonly string[];
  readonly deprovisionMode?: ScimDeprovisionMode;
  readonly groupRoleMappings?: Readonly<Record<string, readonly string[]>>;
  readonly allowedRoleCodes?: readonly string[];
  readonly deniedRoleCodes?: readonly string[];
  readonly defaultRoleCodes?: readonly string[];
  readonly requireIfMatch?: boolean;
}

export const scimProvisioningApi = {
  listClients: (accessToken: string) =>
    fetchApi<ScimClientItem[]>(API_ROUTES.IDENTITY_PROVISIONING.CLIENTS, {
      headers: authHeaders(accessToken),
    }),

  createClient: (accessToken: string, payload: UpsertScimClientPayload) =>
    fetchApi<ScimClientCreatedResult>(API_ROUTES.IDENTITY_PROVISIONING.CLIENTS, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  updateClient: (accessToken: string, clientId: number, payload: UpsertScimClientPayload) =>
    fetchApi<ScimClientItem>(API_ROUTES.IDENTITY_PROVISIONING.CLIENT_BY_ID(clientId), {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  rotateClientToken: (accessToken: string, clientId: number) =>
    fetchApi<ScimClientCreatedResult>(
      API_ROUTES.IDENTITY_PROVISIONING.CLIENT_ROTATE_TOKEN(clientId),
      {
        method: 'POST',
        headers: authHeaders(accessToken),
      },
    ),

  deleteClient: (accessToken: string, clientId: number) =>
    fetchApi<{ deleted: true; id: number }>(
      API_ROUTES.IDENTITY_PROVISIONING.CLIENT_BY_ID(clientId),
      {
        method: 'DELETE',
        headers: authHeaders(accessToken),
      },
    ),

  listUserLinks: (accessToken: string, params?: { clientId?: number; search?: string }) => {
    const qs = new URLSearchParams({ limit: '50' });
    if (params?.clientId) qs.set('clientId', String(params.clientId));
    if (params?.search) qs.set('search', params.search);
    return fetchApi<ScimUserLinkItem[]>(
      API_ROUTES.IDENTITY_PROVISIONING.USER_LINKS(qs.toString()),
      { headers: authHeaders(accessToken) },
    );
  },

  listGroups: (accessToken: string, params?: { clientId?: number; search?: string }) => {
    const qs = new URLSearchParams({ limit: '50' });
    if (params?.clientId) qs.set('clientId', String(params.clientId));
    if (params?.search) qs.set('search', params.search);
    return fetchApi<ScimGroupItem[]>(API_ROUTES.IDENTITY_PROVISIONING.GROUPS(qs.toString()), {
      headers: authHeaders(accessToken),
    });
  },

  listSyncLogs: (
    accessToken: string,
    params?: { clientId?: number; outcome?: string; resourceType?: string },
  ) => {
    const qs = new URLSearchParams({ limit: '50' });
    if (params?.clientId) qs.set('clientId', String(params.clientId));
    if (params?.outcome) qs.set('outcome', params.outcome);
    if (params?.resourceType) qs.set('resourceType', params.resourceType);
    return fetchApi<ScimSyncLogItem[]>(
      API_ROUTES.IDENTITY_PROVISIONING.SYNC_LOGS(qs.toString()),
      { headers: authHeaders(accessToken) },
    );
  },

  listReconciliations: (accessToken: string, clientId?: number) => {
    const qs = new URLSearchParams({ limit: '20' });
    if (clientId) qs.set('clientId', String(clientId));
    return fetchApi<ScimReconciliationRunItem[]>(
      API_ROUTES.IDENTITY_PROVISIONING.RECONCILIATIONS(qs.toString()),
      { headers: authHeaders(accessToken) },
    );
  },

  runReconciliation: (
    accessToken: string,
    clientId: number,
    payload: {
      mode: ScimReconciliationMode;
      applyDeprovisionOrphans?: boolean;
      applySyncMissingAndDrifts?: boolean;
      idpUsers: unknown[];
      idpGroups?: unknown[];
    },
  ) =>
    fetchApi<ScimReconciliationRunItem>(
      API_ROUTES.IDENTITY_PROVISIONING.CLIENT_RECONCILE(clientId),
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify(payload),
      },
    ),
};
