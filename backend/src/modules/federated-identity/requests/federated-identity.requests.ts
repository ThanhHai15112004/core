import { z } from 'zod';
import { createPaginationQuerySchema, optionalQueryParam } from '@packages/http/index.js';
import {
  FEDERATED_PROVIDER_STATUS,
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
    stage: optionalQueryParam(z.string().trim().toUpperCase().max(40)),
    outcome: optionalQueryParam(z.string().trim().toUpperCase().max(16)),
    errorCode: optionalQueryParam(z.string().trim().max(80)),
  }),
);

export type ListMonitoringErrorsQuery = z.infer<typeof ListMonitoringErrorsQuerySchema>;

export type FederatedProviderStatusInput = FederatedProviderStatusCode;
