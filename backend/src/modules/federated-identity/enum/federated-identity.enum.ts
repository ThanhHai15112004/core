export const FEDERATED_PROVIDER_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type FederatedProviderStatusCode =
  (typeof FEDERATED_PROVIDER_STATUS)[keyof typeof FEDERATED_PROVIDER_STATUS];

export type FederatedProviderStatusName = 'ACTIVE' | 'INACTIVE';

export function getFederatedProviderStatusName(code: number): FederatedProviderStatusName {
  return Number(code) === FEDERATED_PROVIDER_STATUS.ACTIVE ? 'ACTIVE' : 'INACTIVE';
}

export const FEDERATED_DRIVER_CODE = {
  GOOGLE: 'google',
  MICROSOFT: 'microsoft',
  OIDC: 'oidc',
  SAML: 'saml',
} as const;

export type FederatedDriverCode =
  (typeof FEDERATED_DRIVER_CODE)[keyof typeof FEDERATED_DRIVER_CODE];

export const FEDERATED_ROLE_SYNC_MODE = {
  ASSIGN_ON_CREATE: 'ASSIGN_ON_CREATE',
  ADDITIVE: 'ADDITIVE',
  SYNC_MANAGED: 'SYNC_MANAGED',
} as const;

export type FederatedRoleSyncMode =
  (typeof FEDERATED_ROLE_SYNC_MODE)[keyof typeof FEDERATED_ROLE_SYNC_MODE];

export const FEDERATED_FEATURE_FLAGS = {
  ENTERPRISE_OIDC_SSO: 'federated_identity.enterprise_oidc_sso',
  ENTERPRISE_SAML_SSO: 'federated_identity.enterprise_saml_sso',
} as const;

export const SAML_CERT_STATUS = {
  ACTIVE: 'ACTIVE',
  TRANSITIONING: 'TRANSITIONING',
  REVOKED: 'REVOKED',
} as const;

export type SamlCertStatus = (typeof SAML_CERT_STATUS)[keyof typeof SAML_CERT_STATUS];

export const SAML_BINDING = {
  HTTP_REDIRECT: 'HTTP-REDIRECT',
  HTTP_POST: 'HTTP-POST',
} as const;

export type SamlBinding = (typeof SAML_BINDING)[keyof typeof SAML_BINDING];

export const SAML_DEFAULTS = {
  DISPLAY_NAME: 'Enterprise SAML 2.0',
  NAME_ID_FORMAT: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  BINDING: SAML_BINDING.HTTP_REDIRECT,
  CLOCK_SKEW_SECONDS: 60,
  TRANSITION_GRACE_DAYS: 7,
  EXCHANGE_CODE_TTL_SECONDS: 60,
  MAX_METADATA_BYTES: 512 * 1024,
  MAX_RESPONSE_BYTES: 512 * 1024,
  DEFAULT_BASE_URL: 'http://localhost:3000/api/v1',
} as const;

export const FEDERATED_PROTECTED_DENIED_ROLES = ['SUPER_ADMIN'] as const;

export const GENERIC_OIDC_DEFAULTS = {
  DISPLAY_NAME: 'Enterprise OIDC',
  SCOPES: ['openid', 'profile', 'email'] as readonly string[],
  DISCOVERY_CACHE_TTL_SECONDS: 3600,
} as const;

export const FEDERATED_FLOW_TYPE = {
  LOGIN: 'LOGIN',
  LINK: 'LINK',
  SAML_EXCHANGE: 'SAML_EXCHANGE',
} as const;

export type FederatedFlowType = (typeof FEDERATED_FLOW_TYPE)[keyof typeof FEDERATED_FLOW_TYPE];

export const FEDERATED_AUTH_STAGE = {
  AUTHORIZE: 'AUTHORIZE',
  DISCOVERY: 'DISCOVERY',
  CALLBACK_VALIDATION: 'CALLBACK_VALIDATION',
  STATE_PKCE: 'STATE_PKCE',
  TOKEN_EXCHANGE: 'TOKEN_EXCHANGE',
  JWKS_FETCH: 'JWKS_FETCH',
  ID_TOKEN_VERIFY: 'ID_TOKEN_VERIFY',
  USERINFO_FETCH: 'USERINFO_FETCH',
  ACCOUNT_RESOLUTION: 'ACCOUNT_RESOLUTION',
  ROLE_SYNC: 'ROLE_SYNC',
  LOGIN_COMPLETION: 'LOGIN_COMPLETION',
  LINK: 'LINK',
  UNLINK: 'UNLINK',
  TEST_CONNECTION: 'TEST_CONNECTION',
  SAML_METADATA: 'SAML_METADATA',
  SAML_AUTHN_REQUEST: 'SAML_AUTHN_REQUEST',
  SAML_SIGNATURE: 'SAML_SIGNATURE',
  SAML_ASSERTION_VALIDATION: 'SAML_ASSERTION_VALIDATION',
  SAML_REPLAY_CHECK: 'SAML_REPLAY_CHECK',
  SAML_ATTRIBUTE_MAPPING: 'SAML_ATTRIBUTE_MAPPING',
  SAML_EXCHANGE: 'SAML_EXCHANGE',
} as const;

export type FederatedAuthStage = (typeof FEDERATED_AUTH_STAGE)[keyof typeof FEDERATED_AUTH_STAGE];

export const FEDERATED_AUTH_OUTCOME = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;

export type FederatedAuthOutcome =
  (typeof FEDERATED_AUTH_OUTCOME)[keyof typeof FEDERATED_AUTH_OUTCOME];

export const FEDERATED_SETTING_KEYS = {
  AUTO_LINK_VERIFIED_EMAIL: 'federated_identity.auto_link_verified_email',
  ALLOW_AUTO_REGISTER: 'federated_identity.allow_auto_register',
  REQUIRE_VERIFIED_EMAIL_FOR_REGISTER: 'federated_identity.require_verified_email_for_register',
  TRANSACTION_TTL_SECONDS: 'federated_identity.transaction_ttl_seconds',
  JWKS_CACHE_TTL_SECONDS: 'federated_identity.jwks_cache_ttl_seconds',
  REQUIRE_STEP_UP_FOR_UNLINK: 'federated_identity.require_step_up_for_unlink',
  ALLOWED_REDIRECT_URIS: 'federated_identity.allowed_redirect_uris',
} as const;

export const FEDERATED_DEFAULTS = {
  AUTO_LINK_VERIFIED_EMAIL: false,
  ALLOW_AUTO_REGISTER: true,
  REQUIRE_VERIFIED_EMAIL_FOR_REGISTER: true,
  TRANSACTION_TTL_SECONDS: 600,
  JWKS_CACHE_TTL_SECONDS: 3600,
  REQUIRE_STEP_UP_FOR_UNLINK: false,
  ALLOWED_REDIRECT_URIS: [
    'http://localhost:5173/auth',
    'http://localhost:5173/auth/oauth/callback',
    'http://127.0.0.1:5173/auth',
    'http://127.0.0.1:5173/auth/oauth/callback',
  ] as readonly string[],
} as const;

export const FEDERATED_AUDIT_META = {
  MODULE: 'federated-identity',
  FEATURE_PROVIDER: 'oauth-provider',
  FEATURE_IDENTITY: 'external-identity',
  FEATURE_ROLE_SYNC: 'sso-role-sync',
  FEATURE_SAML_METADATA: 'saml-metadata',
} as const;

export const GOOGLE_OIDC_DEFAULTS = {
  DISPLAY_NAME: 'Google',
  ISSUER_URL: 'https://accounts.google.com',
  ACCEPTED_ISSUERS: ['https://accounts.google.com', 'accounts.google.com'] as readonly string[],
  AUTHORIZATION_ENDPOINT: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
  JWKS_URI: 'https://www.googleapis.com/oauth2/v3/certs',
  USERINFO_ENDPOINT: 'https://openidconnect.googleapis.com/v1/userinfo',
  SCOPES: ['openid', 'email', 'profile'] as readonly string[],
} as const;

export const MICROSOFT_OIDC_DEFAULTS = {
  DISPLAY_NAME: 'Microsoft',
  DEFAULT_TENANT_ID: 'common',
  MULTI_TENANT_MODES: ['common', 'organizations', 'consumers'] as readonly string[],
  SCOPES: ['openid', 'profile', 'email'] as readonly string[],
  buildIssuerUrl: (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/v2.0`,
  buildAuthorizationEndpoint: (tenantId: string) =>
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
  buildTokenEndpoint: (tenantId: string) =>
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
  buildJwksUri: (tenantId: string) =>
    `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
} as const;
