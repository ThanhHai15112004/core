import { frontendConfig } from '../../../config/index';
import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  FederatedAuthEventItem,
  FederatedDriverMetadata,
  FederatedIdentityItem,
  FederatedMonitoringSummaryData,
  FederatedPolicyData,
  FederatedProviderItem,
  FederatedRoleSyncPolicy,
  InitiateOAuthAuthorizeData,
  OAuthCallbackResponseData,
  OidcClaimMappingConfig,
  OidcDiscoveryTestResult,
  OidcProviderOptions,
  PublicFederatedProvider,
  SamlBindingType,
  SamlCertificateStatus,
  SamlMetadataImportResult,
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
      issuerUrl?: string | null;
      authorizationEndpoint?: string | null;
      tokenEndpoint?: string | null;
      jwksUri?: string | null;
      userinfoEndpoint?: string | null;
      scopes?: string[];
      allowedRedirectUris?: string[];
      allowAutoRegisterOverride?: boolean | null;
      autoLinkVerifiedEmailOverride?: boolean | null;
      oidcOptions?: Partial<OidcProviderOptions>;
      claimMapping?: Partial<OidcClaimMappingConfig>;
      roleSyncPolicy?: Partial<FederatedRoleSyncPolicy>;
      samlConfig?: {
        spEntityId?: string;
        acsUrl?: string;
        nameIdFormat?: string;
        idpEntityId?: string | null;
        idpSsoUrl?: string | null;
        idpSsoBinding?: SamlBindingType;
        wantAssertionsSigned?: boolean;
        authnRequestsSigned?: boolean;
        allowIdpInitiated?: boolean;
        clockSkewSeconds?: number;
        idpCertificates?: readonly {
          id?: string;
          label?: string | null;
          pem: string;
          status?: SamlCertificateStatus;
          graceEndsAt?: string | null;
        }[];
        attributeMapping?: {
          emailAttribute?: string;
          nameAttribute?: string;
          firstNameAttribute?: string;
          lastNameAttribute?: string;
          groupsAttribute?: string;
          requireEmail?: boolean;
          requiredAttributes?: readonly string[];
        };
      };
    },
  ) =>
    fetchApi<FederatedProviderItem>(API_ROUTES.FEDERATED_IDENTITY.PROVIDER_BY_CODE(providerCode), {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  getSamlMetadataUrl: (providerCode: string) =>
    `${frontendConfig.apiBaseUrl.replace(/\/+$/, '')}${API_ROUTES.FEDERATED_IDENTITY.SAML_METADATA(providerCode)}`,

  getSamlAcsUrl: (providerCode: string) =>
    `${frontendConfig.apiBaseUrl.replace(/\/+$/, '')}${API_ROUTES.FEDERATED_IDENTITY.SAML_ACS(providerCode)}`,

  fetchSamlSpMetadataXml: async (providerCode: string): Promise<string> => {
    const url = `${frontendConfig.apiBaseUrl.replace(/\/+$/, '')}${API_ROUTES.FEDERATED_IDENTITY.SAML_METADATA(providerCode)}`;
    const res = await fetch(url, { headers: { Accept: 'application/samlmetadata+xml, application/xml' } });
    if (!res.ok) {
      throw new Error(`Không thể tải SP Metadata (${res.status})`);
    }
    return res.text();
  },

  importSamlMetadata: (
    accessToken: string,
    providerCode: string,
    payload: {
      metadataXml?: string;
      metadataUrl?: string;
      mergeCertificates?: boolean;
      transitionGraceDays?: number;
    },
  ) =>
    fetchApi<SamlMetadataImportResult>(
      API_ROUTES.FEDERATED_IDENTITY.SAML_METADATA_IMPORT(providerCode),
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify(payload),
      },
    ),

  exchangeSamlCode: (
    providerCode: string,
    payload: {
      samlCode: string;
      deviceName?: string;
      trustedDeviceToken?: string;
    },
    accessToken?: string,
  ) =>
    fetchApi<OAuthCallbackResponseData>(API_ROUTES.FEDERATED_IDENTITY.SAML_EXCHANGE(providerCode), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  deleteProvider: (accessToken: string, providerCode: string) =>
    fetchApi<{ readonly deleted: true; readonly providerCode: string }>(
      API_ROUTES.FEDERATED_IDENTITY.PROVIDER_BY_CODE(providerCode),
      {
        method: 'DELETE',
        headers: authHeaders(accessToken),
      },
    ),

  testProvider: (accessToken: string, providerCode: string) =>
    fetchApi<TestFederatedProviderResult>(
      API_ROUTES.FEDERATED_IDENTITY.PROVIDER_TEST(providerCode),
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({}),
      },
    ),

  discoverProvider: (accessToken: string, providerCode: string) =>
    fetchApi<OidcDiscoveryTestResult>(
      API_ROUTES.FEDERATED_IDENTITY.PROVIDER_DISCOVER(providerCode),
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
    query?: {
      page?: number;
      limit?: number;
      outcome?: string;
      providerCode?: string;
      flowType?: string;
      userId?: number;
    },
  ) => {
    const qs = new URLSearchParams();
    if (query?.page) qs.set('page', String(query.page));
    if (query?.limit) qs.set('limit', String(query.limit));
    if (query?.outcome) qs.set('outcome', query.outcome);
    if (query?.providerCode) qs.set('providerCode', query.providerCode);
    if (query?.flowType) qs.set('flowType', query.flowType);
    if (query?.userId) qs.set('userId', String(query.userId));
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
