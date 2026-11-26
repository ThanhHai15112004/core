import { z } from 'zod';
import { createPaginationQuerySchema, optionalQueryParam } from '@packages/http/index.js';
import {
  FEDERATED_PROVIDER_STATUS,
  FEDERATED_ROLE_SYNC_MODE,
  SAML_BINDING,
  SAML_CERT_STATUS,
  type FederatedProviderStatusCode,
} from '../enum/federated-identity.enum.js';

const PROVIDER_CODE_REGEX = /^[a-z0-9][a-z0-9-_]{1,63}$/;

function parseProviderStatus(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim().toUpperCase();
    if (clean === '1' || clean === 'ACTIVE') return FEDERATED_PROVIDER_STATUS.ACTIVE;
    if (clean === '2' || clean === 'INACTIVE') return FEDERATED_PROVIDER_STATUS.INACTIVE;
  }
  return val;
}

export const providerCodeParamSchema = z.object({
  providerCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      PROVIDER_CODE_REGEX,
      'providerCode must be lowercase alphanumeric with hyphens/underscores (2-64 chars)',
    ),
});

export const userIdParamSchema = z.object({
  userId: z.coerce.number().int().min(1),
});

export const userAndIdentityIdParamSchema = z.object({
  userId: z.coerce.number().int().min(1),
  id: z.coerce.number().int().min(1),
});

export const ProviderStatusSchema = z.preprocess(
  parseProviderStatus,
  z.union([
    z.literal(FEDERATED_PROVIDER_STATUS.ACTIVE),
    z.literal(FEDERATED_PROVIDER_STATUS.INACTIVE),
  ]),
);

export const InitiateAuthorizeRequestSchema = z.object({
  redirectUri: z.string().trim().min(1).max(1000),
  loginHint: z.string().trim().max(255).optional(),
  deviceName: z.string().trim().max(255).optional(),
});

export type InitiateAuthorizeRequest = z.infer<typeof InitiateAuthorizeRequestSchema>;

export const OAuthCallbackRequestSchema = z.object({
  code: z.string().trim().min(1).max(4096).optional(),
  state: z.string().trim().min(8).max(512),
  redirectUri: z.string().trim().max(1000).optional(),
  error: z.string().trim().max(120).optional(),
  errorDescription: z.string().trim().max(1000).optional(),
  deviceName: z.string().trim().max(255).optional(),
  trustedDeviceToken: z.string().trim().max(512).optional(),
});

export type OAuthCallbackRequest = z.infer<typeof OAuthCallbackRequestSchema>;

export const UnlinkAccountQuerySchema = z.object({
  stepUpToken: optionalQueryParam(z.string().trim().max(1024)),
});

export type UnlinkAccountQuery = z.infer<typeof UnlinkAccountQuerySchema>;

export const OidcProviderOptionsSchema = z.object({
  discoveryEnabled: z.boolean().optional(),
  discoveryUrl: z.string().trim().max(500).nullable().optional(),
  allowedIssuers: z.array(z.string().trim().min(1).max(255)).max(20).optional(),
  fetchUserInfo: z.boolean().optional(),
  allowedEmailDomains: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
  extraAuthorizeParams: z.record(z.string().trim().min(1).max(64), z.string().max(255)).optional(),
});

export const OidcClaimMappingSchema = z.object({
  emailClaim: z.string().trim().min(1).max(120).optional(),
  emailVerifiedClaim: z.string().trim().min(1).max(120).optional(),
  nameClaim: z.string().trim().min(1).max(120).optional(),
  firstNameClaim: z.string().trim().min(1).max(120).optional(),
  lastNameClaim: z.string().trim().min(1).max(120).optional(),
  avatarClaim: z.string().trim().min(1).max(120).optional(),
  groupsClaim: z.string().trim().min(1).max(120).optional(),
  tenantIdClaim: z.string().trim().min(1).max(120).optional(),
  extraAttributeClaims: z.record(z.string().trim().min(1).max(64), z.string().trim().min(1).max(120)).optional(),
});

export const FederatedRoleSyncPolicySchema = z.object({
  enabled: z.boolean().optional(),
  mode: z
    .enum([
      FEDERATED_ROLE_SYNC_MODE.ASSIGN_ON_CREATE,
      FEDERATED_ROLE_SYNC_MODE.ADDITIVE,
      FEDERATED_ROLE_SYNC_MODE.SYNC_MANAGED,
    ])
    .optional(),
  allowedRoleCodes: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  deniedRoleCodes: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  defaultRoleCodes: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  groupRoleMappings: z
    .record(z.string().trim().min(1).max(255), z.array(z.string().trim().min(1).max(64)).max(20))
    .optional(),
  requireMatchedGroup: z.boolean().optional(),
});

export const SamlIdpCertificateSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().max(120).nullable().optional(),
  pem: z.string().trim().min(32).max(16_384),
  status: z
    .enum([SAML_CERT_STATUS.ACTIVE, SAML_CERT_STATUS.TRANSITIONING, SAML_CERT_STATUS.REVOKED])
    .optional(),
  graceEndsAt: z.string().trim().max(64).nullable().optional(),
});

export const SamlSpCertificateSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().max(120).nullable().optional(),
  pem: z.string().trim().min(32).max(16_384),
  privateKey: z.string().trim().max(16_384).nullable().optional(),
  status: z
    .enum([SAML_CERT_STATUS.ACTIVE, SAML_CERT_STATUS.TRANSITIONING, SAML_CERT_STATUS.REVOKED])
    .optional(),
  graceEndsAt: z.string().trim().max(64).nullable().optional(),
});

export const SamlAttributeMappingSchema = z.object({
  subjectAttribute: z.string().trim().min(1).max(255).nullable().optional(),
  emailAttribute: z.string().trim().min(1).max(255).optional(),
  emailVerifiedAttribute: z.string().trim().min(1).max(255).nullable().optional(),
  nameAttribute: z.string().trim().min(1).max(255).optional(),
  firstNameAttribute: z.string().trim().min(1).max(255).optional(),
  lastNameAttribute: z.string().trim().min(1).max(255).optional(),
  avatarAttribute: z.string().trim().min(1).max(255).nullable().optional(),
  groupsAttribute: z.string().trim().min(1).max(255).optional(),
  tenantIdAttribute: z.string().trim().min(1).max(255).nullable().optional(),
  extraAttributes: z.record(z.string().trim().min(1).max(64), z.string().trim().min(1).max(255)).optional(),
  requireEmail: z.boolean().optional(),
  requiredAttributes: z.array(z.string().trim().min(1).max(255)).max(30).optional(),
  treatEmailAsVerified: z.boolean().optional(),
});

export const SamlProviderConfigSchema = z.object({
  spEntityId: z.string().trim().min(1).max(500).optional(),
  acsUrl: z.string().trim().min(1).max(500).optional(),
  nameIdFormat: z.string().trim().min(1).max(255).optional(),
  idpEntityId: z.string().trim().max(500).nullable().optional(),
  idpSsoUrl: z.string().trim().max(500).nullable().optional(),
  idpSsoBinding: z.enum([SAML_BINDING.HTTP_REDIRECT, SAML_BINDING.HTTP_POST]).optional(),
  wantAssertionsSigned: z.boolean().optional(),
  authnRequestsSigned: z.boolean().optional(),
  allowIdpInitiated: z.boolean().optional(),
  clockSkewSeconds: z.coerce.number().int().min(0).max(300).optional(),
  idpCertificates: z.array(SamlIdpCertificateSchema).max(10).optional(),
  spCertificates: z.array(SamlSpCertificateSchema).max(5).optional(),
  attributeMapping: SamlAttributeMappingSchema.optional(),
});

export const ImportSamlMetadataRequestSchema = z
  .object({
    metadataXml: z.string().trim().min(1).max(524_288).optional(),
    metadataUrl: z.string().trim().url().max(1000).optional(),
    mergeCertificates: z.boolean().optional(),
    transitionGraceDays: z.coerce.number().int().min(1).max(90).optional(),
  })
  .refine((data) => Boolean(data.metadataXml || data.metadataUrl), {
    message: 'Either metadataXml or metadataUrl is required',
  });

export type ImportSamlMetadataRequest = z.infer<typeof ImportSamlMetadataRequestSchema>;

export const SamlAcsRequestSchema = z
  .object({
    SAMLResponse: z.string().trim().min(1).max(1_048_576).optional(),
    samlResponse: z.string().trim().min(1).max(1_048_576).optional(),
    RelayState: z.string().trim().max(1024).optional(),
    relayState: z.string().trim().max(1024).optional(),
    deviceName: z.string().trim().max(255).optional(),
    trustedDeviceToken: z.string().trim().max(512).optional(),
    responseMode: z.enum(['redirect', 'json']).optional(),
  })
  .refine((data) => Boolean(data.SAMLResponse || data.samlResponse), {
    message: 'SAMLResponse is required',
  });

export type SamlAcsRequest = z.infer<typeof SamlAcsRequestSchema>;

export const SamlExchangeRequestSchema = z.object({
  samlCode: z.string().trim().min(16).max(512),
  deviceName: z.string().trim().max(255).optional(),
  trustedDeviceToken: z.string().trim().max(512).optional(),
});

export type SamlExchangeRequest = z.infer<typeof SamlExchangeRequestSchema>;

export const UpsertFederatedProviderRequestSchema = z.object({
  driverCode: z.string().trim().toLowerCase().min(2).max(64).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  status: ProviderStatusSchema.optional(),
  isEnabled: z.boolean().optional(),
  clientId: z.string().trim().max(255).nullable().optional(),
  clientSecret: z.string().max(1024).nullable().optional(),
  tenantId: z.string().trim().max(120).nullable().optional(),
  issuerUrl: z.string().trim().max(255).nullable().optional(),
  authorizationEndpoint: z.string().trim().max(500).nullable().optional(),
  tokenEndpoint: z.string().trim().max(500).nullable().optional(),
  jwksUri: z.string().trim().max(500).nullable().optional(),
  userinfoEndpoint: z.string().trim().max(500).nullable().optional(),
  scopes: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  allowedRedirectUris: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  allowAutoRegisterOverride: z.boolean().nullable().optional(),
  autoLinkVerifiedEmailOverride: z.boolean().nullable().optional(),
  oidcOptions: OidcProviderOptionsSchema.optional(),
  claimMapping: OidcClaimMappingSchema.optional(),
  roleSyncPolicy: FederatedRoleSyncPolicySchema.optional(),
  samlConfig: SamlProviderConfigSchema.optional(),
});

export type UpsertFederatedProviderRequest = z.infer<typeof UpsertFederatedProviderRequestSchema>;

export const MonitoringSummaryQuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(720).optional(),
  providerCode: optionalQueryParam(z.string().trim().toLowerCase().max(64)),
});

export type MonitoringSummaryQuery = z.infer<typeof MonitoringSummaryQuerySchema>;

export const ListMonitoringErrorsQuerySchema = createPaginationQuerySchema({
  maxLimit: 100,
}).and(
  z.object({
    providerCode: optionalQueryParam(z.string().trim().toLowerCase().max(64)),
    flowType: optionalQueryParam(z.string().trim().toUpperCase().max(16)),
    userId: optionalQueryParam(z.coerce.number().int().min(1)),
    stage: optionalQueryParam(z.string().trim().toUpperCase().max(40)),
    outcome: optionalQueryParam(z.string().trim().toUpperCase().max(16)),
    errorCode: optionalQueryParam(z.string().trim().max(80)),
  }),
);

export type ListMonitoringErrorsQuery = z.infer<typeof ListMonitoringErrorsQuerySchema>;

export type FederatedProviderStatusInput = FederatedProviderStatusCode;
