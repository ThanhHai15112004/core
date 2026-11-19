import type { PaginatedResult } from '@packages/kernel/index.js';
import type {
  FederatedAuthEventView,
  FederatedDriverMetadata,
  FederatedIdentityView,
  FederatedMonitoringSummaryView,
  FederatedPolicyView,
  FederatedProviderView,
  InitiateOAuthAuthorizeResult,
  OAuthAdapterResolvedConfig,
  OAuthCallbackResult,
  PublicFederatedProviderView,
  TestProviderConnectionResult,
  UnlinkFederatedIdentityResult,
  VerifiedExternalProfile,
} from '../types/federated-identity.types.js';

export * from '../enum/federated-identity.enum.js';
export * from '../types/federated-identity.types.js';

export interface IOAuthProviderAdapter {
  readonly driverCode: string;
  getMetadata(): FederatedDriverMetadata;
  resolveEndpoints(config: OAuthAdapterResolvedConfig): {
    readonly issuerUrl: string;
    readonly authorizationEndpoint: string;
    readonly tokenEndpoint: string;
    readonly jwksUri: string;
    readonly userinfoEndpoint: string | null;
    readonly scopes: readonly string[];
  };
  buildAuthorizationUrl(params: {
    readonly config: OAuthAdapterResolvedConfig;
    readonly redirectUri: string;
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
    readonly loginHint?: string | undefined;
  }): string;
  exchangeCodeAndVerify(params: {
    readonly config: OAuthAdapterResolvedConfig;
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
    readonly expectedNonceHash: string;
    readonly jwksCacheTtlSeconds: number;
  }): Promise<VerifiedExternalProfile>;
  testConnection(params: {
    readonly config: OAuthAdapterResolvedConfig;
    readonly jwksCacheTtlSeconds: number;
  }): Promise<TestProviderConnectionResult>;
}

export interface IFederatedIdentityPublicService {
  listPublicProviders(): Promise<PublicFederatedProviderView[]>;
  initiateLoginAuthorize(
    providerCode: string,
    input: {
      readonly redirectUri: string;
      readonly loginHint?: string | undefined;
      readonly deviceName?: string | undefined;
    },
    meta?: {
      readonly ipAddress?: string | null | undefined;
      readonly userAgent?: string | null | undefined;
    },
  ): Promise<InitiateOAuthAuthorizeResult>;
  handleCallback(
    providerCode: string,
    input: {
      readonly code?: string | undefined;
      readonly state: string;
      readonly redirectUri?: string | undefined;
      readonly error?: string | undefined;
      readonly errorDescription?: string | undefined;
      readonly deviceName?: string | undefined;
      readonly trustedDeviceToken?: string | undefined;
    },
    context?: {
      readonly actorUserId?: number | null | undefined;
      readonly expectedFlowType?: 'LOGIN' | 'LINK' | undefined;
      readonly ipAddress?: string | null | undefined;
      readonly userAgent?: string | null | undefined;
      readonly requestId?: string | null | undefined;
      readonly correlationId?: string | null | undefined;
    },
  ): Promise<OAuthCallbackResult>;
  listUserIdentities(userId: number): Promise<FederatedIdentityView[]>;
  unlinkUserIdentity(
    targetUserId: number,
    identityId: number,
    options?: {
      readonly actorUserId?: number | undefined;
      readonly stepUpToken?: string | undefined;
      readonly enforceSelfStepUp?: boolean | undefined;
      readonly ipAddress?: string | null | undefined;
      readonly userAgent?: string | null | undefined;
    },
  ): Promise<UnlinkFederatedIdentityResult>;
  listProviders(): Promise<FederatedProviderView[]>;
  getPolicy(): Promise<FederatedPolicyView>;
  getMonitoringSummary(
    windowHours?: number,
    providerCode?: string,
  ): Promise<FederatedMonitoringSummaryView>;
  listAuthEvents(query?: {
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
    readonly providerCode?: string | undefined;
    readonly stage?: string | undefined;
    readonly outcome?: string | undefined;
    readonly errorCode?: string | undefined;
  }): Promise<PaginatedResult<FederatedAuthEventView>>;
}

export const FEDERATED_IDENTITY_PUBLIC_SERVICE = Symbol('FEDERATED_IDENTITY_PUBLIC_SERVICE');
export const OAUTH_PROVIDER_REGISTRY = Symbol('OAUTH_PROVIDER_REGISTRY');
