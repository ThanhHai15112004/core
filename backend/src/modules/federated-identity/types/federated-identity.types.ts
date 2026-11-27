import type { LoginResponse } from '@modules/auth/contracts/index.js';
import type {
  FederatedAuthOutcome,
  FederatedAuthStage,
  FederatedFlowType,
  FederatedProviderStatusCode,
  FederatedProviderStatusName,
  FederatedRoleSyncMode,
  SamlBinding,
  SamlCertStatus,
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

export interface OidcResolvedEndpoints {
  readonly issuerUrl: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly userinfoEndpoint: string | null;
  readonly scopes: readonly string[];
  readonly discovered?: boolean | undefined;
}

export interface OidcDiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly userinfo_endpoint?: string | undefined;
  readonly end_session_endpoint?: string | undefined;
  readonly scopes_supported?: readonly string[] | undefined;
  readonly id_token_signing_alg_values_supported?: readonly string[] | undefined;
}

export interface OidcProviderOptions {
  readonly discoveryEnabled: boolean;
  readonly discoveryUrl: string | null;
  readonly allowedIssuers: readonly string[];
  readonly fetchUserInfo: boolean;
  readonly allowedEmailDomains: readonly string[];
  readonly extraAuthorizeParams: Readonly<Record<string, string>>;
}

export interface OidcClaimMappingConfig {
  readonly emailClaim: string;
  readonly emailVerifiedClaim: string;
  readonly nameClaim: string;
  readonly firstNameClaim: string;
  readonly lastNameClaim: string;
  readonly avatarClaim: string;
  readonly groupsClaim: string;
  readonly tenantIdClaim: string;
  readonly extraAttributeClaims: Readonly<Record<string, string>>;
}

export interface FederatedRoleSyncPolicy {
  readonly enabled: boolean;
  readonly mode: FederatedRoleSyncMode;
  readonly allowedRoleCodes: readonly string[];
  readonly deniedRoleCodes: readonly string[];
  readonly defaultRoleCodes: readonly string[];
  readonly groupRoleMappings: Readonly<Record<string, readonly string[]>>;
  readonly requireMatchedGroup: boolean;
}

export type SamlCertificateStatus = SamlCertStatus;
export type SamlBindingType = SamlBinding;

export interface SamlIdpCertificateConfig {
  readonly id: string;
  readonly label?: string | null | undefined;
  readonly pem: string;
  readonly fingerprint256: string;
  readonly subject: string | null;
  readonly validFrom: string;
  readonly validTo: string;
  readonly status: SamlCertificateStatus;
  readonly graceEndsAt: string | null;
}

export interface SamlSpCertificateStoredConfig {
  readonly id: string;
  readonly label?: string | null | undefined;
  readonly pem: string;
  readonly fingerprint256: string;
  readonly subject: string | null;
  readonly validFrom: string;
  readonly validTo: string;
  readonly status: SamlCertificateStatus;
  readonly graceEndsAt: string | null;
  readonly privateKeyEncrypted: string | null;
}

export interface SamlSpCertificatePublicView {
  readonly id: string;
  readonly label?: string | null | undefined;
  readonly pem: string;
  readonly fingerprint256: string;
  readonly subject: string | null;
  readonly validFrom: string;
  readonly validTo: string;
  readonly status: SamlCertificateStatus;
  readonly graceEndsAt: string | null;
  readonly hasPrivateKey: boolean;
}

export interface SamlAttributeMappingConfig {
  readonly subjectAttribute: string | null;
  readonly emailAttribute: string;
  readonly emailVerifiedAttribute: string | null;
  readonly nameAttribute: string;
  readonly firstNameAttribute: string;
  readonly lastNameAttribute: string;
  readonly avatarAttribute: string | null;
  readonly groupsAttribute: string;
  readonly tenantIdAttribute: string | null;
  readonly extraAttributes: Readonly<Record<string, string>>;
  readonly requireEmail: boolean;
  readonly requiredAttributes: readonly string[];
  readonly treatEmailAsVerified: boolean;
}

export interface SamlProviderConfig {
  readonly spEntityId: string;
  readonly acsUrl: string;
  readonly nameIdFormat: string;
  readonly idpEntityId: string | null;
  readonly idpSsoUrl: string | null;
  readonly idpSsoBinding: SamlBindingType;
  readonly wantAssertionsSigned: boolean;
  readonly authnRequestsSigned: boolean;
  readonly allowIdpInitiated: boolean;
  readonly clockSkewSeconds: number;
  readonly idpCertificates: readonly SamlIdpCertificateConfig[];
  readonly spCertificates: readonly SamlSpCertificateStoredConfig[];
  readonly attributeMapping: SamlAttributeMappingConfig;
}

export interface SamlProviderConfigView {
  readonly spEntityId: string;
  readonly acsUrl: string;
  readonly nameIdFormat: string;
  readonly idpEntityId: string | null;
  readonly idpSsoUrl: string | null;
  readonly idpSsoBinding: SamlBindingType;
  readonly wantAssertionsSigned: boolean;
  readonly authnRequestsSigned: boolean;
  readonly allowIdpInitiated: boolean;
  readonly clockSkewSeconds: number;
  readonly idpCertificates: readonly SamlIdpCertificateConfig[];
  readonly spCertificates: readonly SamlSpCertificatePublicView[];
  readonly attributeMapping: SamlAttributeMappingConfig;
}

export interface FederatedProviderExtraConfig {
  readonly oidcOptions: OidcProviderOptions;
  readonly claimMapping: OidcClaimMappingConfig;
  readonly roleSyncPolicy: FederatedRoleSyncPolicy;
  readonly samlConfig?: SamlProviderConfig | undefined;
}

export interface FederatedRoleSyncSummary {
  readonly enabled: boolean;
  readonly applied: boolean;
  readonly mode: FederatedRoleSyncMode;
  readonly action:
    'DISABLED' | 'SKIPPED_EXISTING_USER' | 'UNCHANGED' | 'UPDATED' | 'NO_ROLES_SERVICE';
  readonly matchedGroups: readonly string[];
  readonly appliedRoleCodes: readonly string[];
  readonly blockedRoleCodes: readonly string[];
  readonly ignoredRoleCodes: readonly string[];
}

export interface OidcDiscoveryTestResult {
  readonly providerCode: string;
  readonly issuerUrl: string;
  readonly discoveryUrl: string;
  readonly ok: boolean;
  readonly discovered: boolean;
  readonly authorizationEndpoint: string | null;
  readonly tokenEndpoint: string | null;
  readonly jwksUri: string | null;
  readonly userinfoEndpoint: string | null;
  readonly durationMs: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
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
  readonly groups?: readonly string[] | undefined;
  readonly attributes?: Readonly<Record<string, string | number | boolean | null>> | undefined;
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
  readonly oidcOptions: OidcProviderOptions;
  readonly claimMapping: OidcClaimMappingConfig;
  readonly roleSyncPolicy: FederatedRoleSyncPolicy;
  readonly samlConfig?: SamlProviderConfigView | undefined;
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
  readonly binding?: SamlBindingType | undefined;
  readonly samlRequest?: string | undefined;
  readonly relayState?: string | undefined;
  readonly requestId?: string | undefined;
}

export interface SamlMetadataImportResult {
  readonly providerCode: string;
  readonly idpEntityId: string;
  readonly idpSsoUrl: string;
  readonly idpSsoBinding: SamlBindingType;
  readonly importedCertificatesCount: number;
  readonly transitionedCertificatesCount: number;
  readonly activeCertificatesCount: number;
  readonly provider: FederatedProviderView;
}

export interface OAuthCallbackLoginResult {
  readonly flowType: 'LOGIN';
  readonly providerCode: string;
  readonly isNewUser: boolean;
  readonly autoLinked: boolean;
  readonly identity: FederatedIdentityView;
  readonly loginResult: LoginResponse;
  readonly roleSync?: FederatedRoleSyncSummary | undefined;
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
  readonly issuerUrl?: string | null | undefined;
  readonly discovered?: boolean | undefined;
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
