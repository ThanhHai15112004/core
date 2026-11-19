import type { LoginResponse } from '@modules/auth/contracts/index.js';
import type {
  FederatedAuthOutcome,
  FederatedAuthStage,
  FederatedFlowType,
  FederatedProviderStatusCode,
  FederatedProviderStatusName,
} from '../enum/federated-identity.enum.js';

export interface FederatedRuntimeConfig {
  readonly autoLinkVerifiedEmail: boolean;
  readonly allowAutoRegister: boolean;
  readonly requireVerifiedEmailForRegister: boolean;
  readonly transactionTtlSeconds: number;
  readonly jwksCacheTtlSeconds: number;
  readonly requireStepUpForUnlink: boolean;
  readonly allowedRedirectUris: readonly string[];
}

export interface EffectiveProviderPolicy {
  readonly allowAutoRegister: boolean;
  readonly autoLinkVerifiedEmail: boolean;
  readonly requireVerifiedEmailForRegister: boolean;
}

export interface FederatedDriverMetadata {
  readonly driverCode: string;
  readonly displayName: string;
  readonly supportsTenantId: boolean;
  readonly defaultTenantId: string | null;
  readonly defaultScopes: readonly string[];
  readonly defaultAuthorizationEndpoint: string;
  readonly defaultTokenEndpoint: string;
  readonly defaultJwksUri: string;
  readonly defaultUserinfoEndpoint: string | null;
  readonly defaultIssuerUrl: string;
}

export interface OAuthAdapterResolvedConfig {
  readonly providerCode: string;
  readonly driverCode: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tenantId: string | null;
  readonly issuerUrl: string | null;
  readonly authorizationEndpoint: string | null;
  readonly tokenEndpoint: string | null;
  readonly jwksUri: string | null;
  readonly userinfoEndpoint: string | null;
  readonly scopes: readonly string[];
  readonly extraConfig: Record<string, unknown>;
}

export interface VerifiedExternalProfile {
  readonly providerCode: string;
  readonly driverCode: string;
  readonly issuer: string;
  readonly subject: string;
  readonly tenantId: string | null;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly displayName: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly avatarUrl: string | null;
  readonly rawClaimsSummary: Record<string, unknown>;
}

export interface PublicFederatedProviderView {
  readonly providerCode: string;
  readonly driverCode: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly tenantId: string | null;
}

export interface FederatedProviderView {
  readonly id: number;
  readonly providerCode: string;
  readonly driverCode: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly status: FederatedProviderStatusCode;
  readonly statusName: FederatedProviderStatusName;
  readonly isEnabled: boolean;
  readonly isConfigured: boolean;
  readonly clientId: string | null;
  readonly hasClientSecret: boolean;
  readonly clientSecretHint: string | null;
  readonly tenantId: string | null;
  readonly issuerUrl: string | null;
  readonly authorizationEndpoint: string | null;
  readonly tokenEndpoint: string | null;
  readonly jwksUri: string | null;
  readonly userinfoEndpoint: string | null;
  readonly scopes: readonly string[];
  readonly allowedRedirectUris: readonly string[];
  readonly allowAutoRegisterOverride: boolean | null;
  readonly autoLinkVerifiedEmailOverride: boolean | null;
  readonly effectivePolicy: EffectiveProviderPolicy;
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
  readonly lastErrorCode: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FederatedIdentityView {
  readonly id: number;
  readonly userId: number;
  readonly providerId: number;
  readonly providerCode: string;
  readonly issuerUrl: string;
  readonly providerSubject: string;
  readonly providerTenantId: string | null;
  readonly emailAtProvider: string | null;
  readonly emailVerified: boolean;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly linkedAt: string;
  readonly lastLoginAt: string | null;
}

export interface InitiateOAuthAuthorizeResult {
  readonly providerCode: string;
  readonly driverCode: string;
  readonly flowType: FederatedFlowType;
  readonly authorizationUrl: string;
  readonly state: string;
  readonly codeChallengeMethod: 'S256';
  readonly expiresAt: string;
}

export interface OAuthCallbackLoginResult {
  readonly flowType: 'LOGIN';
  readonly providerCode: string;
  readonly isNewUser: boolean;
  readonly autoLinked: boolean;
  readonly identity: FederatedIdentityView;
  readonly loginResult: LoginResponse;
}

export interface OAuthCallbackLinkResult {
  readonly flowType: 'LINK';
  readonly providerCode: string;
  readonly linked: true;
  readonly alreadyLinked: boolean;
  readonly identity: FederatedIdentityView;
}

export type OAuthCallbackResult = OAuthCallbackLoginResult | OAuthCallbackLinkResult;

export interface UnlinkFederatedIdentityResult {
  readonly unlinked: true;
  readonly id: number;
  readonly providerCode: string;
  readonly remainingLinkedCount: number;
  readonly hasLocalPassword: boolean;
}

export interface TestProviderConnectionResult {
  readonly providerCode: string;
  readonly driverCode: string;
  readonly ok: boolean;
  readonly configured: boolean;
  readonly jwksUri: string;
  readonly keyCount: number;
  readonly durationMs: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface FederatedPolicyView {
  readonly runtimeConfig: FederatedRuntimeConfig;
  readonly settingKeys: {
    readonly autoLinkVerifiedEmail: string;
    readonly allowAutoRegister: string;
    readonly requireVerifiedEmailForRegister: string;
    readonly transactionTtlSeconds: string;
    readonly jwksCacheTtlSeconds: string;
    readonly requireStepUpForUnlink: string;
    readonly allowedRedirectUris: string;
  };
}

export interface FederatedAuthEventView {
  readonly id: number;
  readonly eventUid: string;
  readonly providerCode: string;
  readonly flowType: FederatedFlowType | string;
  readonly stage: FederatedAuthStage | string;
  readonly outcome: FederatedAuthOutcome | string;
  readonly errorCode: string | null;
  readonly providerError: string | null;
  readonly errorMessage: string | null;
  readonly httpStatus: number | null;
  readonly durationMs: number;
  readonly userId: number | null;
  readonly identityId: number | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly sourceIpMasked: string | null;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: string;
}

export interface FederatedProviderMonitoringStats {
  readonly providerCode: string;
  readonly totalAttempts: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly errorRatePercent: number;
  readonly avgDurationMs: number;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly lastErrorCode: string | null;
}

export interface FederatedMonitoringSummaryView {
  readonly windowHours: number;
  readonly since: string;
  readonly totalAttempts: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly errorRatePercent: number;
  readonly avgDurationMs: number;
  readonly byProvider: readonly FederatedProviderMonitoringStats[];
  readonly byStage: readonly { readonly stage: string; readonly count: number }[];
  readonly topErrors: readonly {
    readonly errorCode: string;
    readonly providerError: string | null;
    readonly count: number;
    readonly lastOccurredAt: string;
  }[];
}
