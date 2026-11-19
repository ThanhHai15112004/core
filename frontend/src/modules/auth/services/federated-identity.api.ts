import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  FederatedAuthEventItem,
  FederatedDriverMetadata,
  FederatedIdentityItem,
  FederatedMonitoringSummaryData,
  FederatedPolicyData,
  FederatedProviderItem,
  InitiateOAuthAuthorizeData,
  OAuthCallbackResponseData,
  PublicFederatedProvider,
  TestFederatedProviderResult,
  UnlinkFederatedIdentityData,
} from '../types/federated-identity.types';

function authHeaders(accessToken?: string): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export const federatedIdentityApi = {
  listPublicProviders: () =>
    fetchApi<PublicFederatedProvider[]>(API_ROUTES.FEDERATED_IDENTITY.PUBLIC_PROVIDERS),

  initiateLoginAuthorize: (
    providerCode: string,
    payload: { redirectUri: string; loginHint?: string; deviceName?: string },
  ) =>
    fetchApi<InitiateOAuthAuthorizeData>(API_ROUTES.FEDERATED_IDENTITY.AUTHORIZE(providerCode), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  handleCallback: (
    providerCode: string,
    payload: {
      code?: string;
      state: string;
      redirectUri?: string;
      error?: string;
      errorDescription?: string;
      deviceName?: string;
      trustedDeviceToken?: string;
    },
    accessToken?: string,
  ) =>
    fetchApi<OAuthCallbackResponseData>(API_ROUTES.FEDERATED_IDENTITY.CALLBACK(providerCode), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  listMyAccounts: (accessToken: string) =>
    fetchApi<FederatedIdentityItem[]>(API_ROUTES.FEDERATED_IDENTITY.MY_ACCOUNTS, {
      headers: authHeaders(accessToken),
    }),

  initiateLinkAuthorize: (
    accessToken: string,
    providerCode: string,
    payload: { redirectUri: string; loginHint?: string; deviceName?: string },
  ) =>
    fetchApi<InitiateOAuthAuthorizeData>(
      API_ROUTES.FEDERATED_IDENTITY.LINK_AUTHORIZE(providerCode),
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify(payload),
      },
    ),

  handleLinkCallback: (
    accessToken: string,
    providerCode: string,
    payload: {
      code?: string;
      state: string;
      redirectUri?: string;
      error?: string;
      errorDescription?: string;
    },
  ) =>
    fetchApi<OAuthCallbackResponseData>(
      API_ROUTES.FEDERATED_IDENTITY.LINK_CALLBACK(providerCode),
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify(payload),
      },
    ),

  unlinkMyAccount: (accessToken: string, id: number, stepUpToken?: string) =>
    fetchApi<UnlinkFederatedIdentityData>(
      API_ROUTES.FEDERATED_IDENTITY.UNLINK_ACCOUNT(id, stepUpToken),
      {
        method: 'DELETE',
        headers: authHeaders(accessToken),
      },
    ),

  listDrivers: (accessToken: string) =>
    fetchApi<FederatedDriverMetadata[]>(API_ROUTES.FEDERATED_IDENTITY.DRIVERS, {
      headers: authHeaders(accessToken),
    }),

  getPolicy: (accessToken: string) =>
    fetchApi<FederatedPolicyData>(API_ROUTES.FEDERATED_IDENTITY.POLICY, {
      headers: authHeaders(accessToken),
    }),

  listProviders: (accessToken: string) =>
    fetchApi<FederatedProviderItem[]>(API_ROUTES.FEDERATED_IDENTITY.PROVIDERS, {
      headers: authHeaders(accessToken),
    }),

  upsertProvider: (
    accessToken: string,
    providerCode: string,
    payload: {
      driverCode?: string;
      displayName?: string;
      description?: string | null;
      isEnabled?: boolean;
      clientId?: string | null;
      clientSecret?: string | null;
      tenantId?: string | null;
      scopes?: string[];
      allowedRedirectUris?: string[];
      allowAutoRegisterOverride?: boolean | null;
      autoLinkVerifiedEmailOverride?: boolean | null;
    },
  ) =>
    fetchApi<FederatedProviderItem>(API_ROUTES.FEDERATED_IDENTITY.PROVIDER_BY_CODE(providerCode), {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  testProvider: (accessToken: string, providerCode: string) =>
    fetchApi<TestFederatedProviderResult>(
      API_ROUTES.FEDERATED_IDENTITY.PROVIDER_TEST(providerCode),
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({}),
      },
    ),

  getMonitoringSummary: (accessToken: string, windowHours = 24, providerCode?: string) => {
    const qs = new URLSearchParams({ windowHours: String(windowHours) });
    if (providerCode?.trim()) qs.set('providerCode', providerCode.trim());
    return fetchApi<FederatedMonitoringSummaryData>(
      API_ROUTES.FEDERATED_IDENTITY.MONITORING_SUMMARY(qs.toString()),
      { headers: authHeaders(accessToken) },
    );
  },

  listMonitoringEvents: (
    accessToken: string,
    query?: { page?: number; limit?: number; outcome?: string; providerCode?: string },
  ) => {
    const qs = new URLSearchParams();
    if (query?.page) qs.set('page', String(query.page));
    if (query?.limit) qs.set('limit', String(query.limit));
    if (query?.outcome) qs.set('outcome', query.outcome);
    if (query?.providerCode) qs.set('providerCode', query.providerCode);
    return fetchApiWithMeta<FederatedAuthEventItem[]>(
      API_ROUTES.FEDERATED_IDENTITY.MONITORING_ERRORS(qs.toString()),
      { headers: authHeaders(accessToken) },
    );
  },

  updateGlobalPolicy: (
    accessToken: string,
    items: readonly { key: string; value: unknown }[],
  ) =>
    fetchApi<unknown[]>(API_ROUTES.SETTINGS.BULK, {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        reason: 'Updated OAuth / Federated Identity policy via Auth Console',
        items,
      }),
    }),
};
