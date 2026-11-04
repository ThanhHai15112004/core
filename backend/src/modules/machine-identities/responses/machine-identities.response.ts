import { z } from 'zod';

// ============================================================================
// MỤC 3.6: TÀI KHOẢN HỆ THỐNG (SERVICE ACCOUNT) & API CLIENT RESPONSES
// ============================================================================

export interface ServiceAccountResponse {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  readonly isServiceAccount: true;
  readonly userId: null;
  readonly scopes: readonly string[];
  readonly createdBy: number | null;
  readonly lastUsedAt: string | null;
  readonly lastUsedIp: string | null;
  readonly lastUsedResult: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiClientResponse {
  readonly id: number;
  readonly serviceAccountId: number;
  readonly serviceAccountCode?: string;
  readonly serviceAccountName?: string;
  readonly name: string;
  readonly description: string | null;
  readonly clientId: string;
  readonly secretPrefix: string;
  readonly scopes: readonly string[];
  readonly allowedIps: readonly string[];
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'REVOKED';
  readonly tokenVersion: number;
  readonly secretRotatedAt: string | null;
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
  readonly lastUsedAt: string | null;
  readonly lastUsedIp: string | null;
  readonly lastUsedResult: string | null;
  readonly lastUsedEndpoint: string | null;
  readonly createdBy: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiClientCreatedWithSecretResponse extends ApiClientResponse {
  readonly clientSecret: string;
  readonly oneTimeSecretWarning: true;
}

export interface ApiClientRotateSecretResponse {
  readonly rotated: true;
  readonly id: number;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly secretPrefix: string;
  readonly tokenVersion: number;
  readonly secretRotatedAt: string;
  readonly oneTimeSecretWarning: true;
}

export interface ApiClientRevokeResponse {
  readonly revoked: true;
  readonly id: number;
  readonly clientId: string;
  readonly status: number;
  readonly statusName: 'REVOKED';
  readonly tokenVersion: number;
  readonly revokedAt: string;
  readonly revokedReason: string | null;
}

export interface ApiClientTokenResponse {
  readonly tokenType: 'Bearer';
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly clientId: string;
  readonly serviceAccountId: number;
  readonly serviceAccountCode: string;
  readonly scopes: readonly string[];
}

export interface ApiClientUsageLogResponse {
  readonly id: number;
  readonly clientId: string;
  readonly serviceAccountId: number;
  readonly lastUsedAt: string | null;
  readonly lastUsedIp: string | null;
  readonly lastUsedResult: string | null;
  readonly lastUsedEndpoint: string | null;
  readonly logs: ReadonlyArray<{
    readonly timestamp: string;
    readonly ipAddress: string | null;
    readonly action: 'ISSUE_TOKEN' | 'API_REQUEST';
    readonly endpoint: string | null;
    readonly status: 'SUCCESS' | 'FAILED';
    readonly result: string;
    readonly reason?: string | null;
  }>;
}

export const serviceAccountResponseSchema = z.object({
  id: z.number().int().min(1),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.number().int().min(1).max(3),
  statusName: z.enum(['ACTIVE', 'INACTIVE', 'REVOKED']),
  isServiceAccount: z.literal(true),
  userId: z.null(),
  scopes: z.array(z.string()),
  createdBy: z.number().int().nullable(),
  lastUsedAt: z.string().nullable(),
  lastUsedIp: z.string().nullable(),
  lastUsedResult: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const apiClientResponseSchema = z.object({
  id: z.number().int().min(1),
  serviceAccountId: z.number().int().min(1),
  serviceAccountCode: z.string().optional(),
  serviceAccountName: z.string().optional(),
  name: z.string(),
  description: z.string().nullable(),
  clientId: z.string(),
  secretPrefix: z.string(),
  scopes: z.array(z.string()),
  allowedIps: z.array(z.string()),
  status: z.number().int().min(1).max(2),
  statusName: z.enum(['ACTIVE', 'REVOKED']),
  tokenVersion: z.number().int().min(1),
  secretRotatedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  lastUsedIp: z.string().nullable(),
  lastUsedResult: z.string().nullable(),
  lastUsedEndpoint: z.string().nullable(),
  createdBy: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const apiClientCreatedWithSecretResponseSchema = apiClientResponseSchema.extend({
  clientSecret: z.string(),
  oneTimeSecretWarning: z.literal(true),
});

export const apiClientRotateSecretResponseSchema = z.object({
  rotated: z.literal(true),
  id: z.number().int().min(1),
  clientId: z.string(),
  clientSecret: z.string(),
  secretPrefix: z.string(),
  tokenVersion: z.number().int().min(1),
  secretRotatedAt: z.string(),
  oneTimeSecretWarning: z.literal(true),
});

export const apiClientRevokeResponseSchema = z.object({
  revoked: z.literal(true),
  id: z.number().int().min(1),
  clientId: z.string(),
  status: z.number().int(),
  statusName: z.literal('REVOKED'),
  tokenVersion: z.number().int().min(1),
  revokedAt: z.string(),
  revokedReason: z.string().nullable(),
});

export const apiClientTokenResponseSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
  clientId: z.string(),
  serviceAccountId: z.number().int().min(1),
  serviceAccountCode: z.string(),
  scopes: z.array(z.string()),
});

export const apiClientUsageLogResponseSchema = z.object({
  id: z.number().int().min(1),
  clientId: z.string(),
  serviceAccountId: z.number().int().min(1),
  lastUsedAt: z.string().nullable(),
  lastUsedIp: z.string().nullable(),
  lastUsedResult: z.string().nullable(),
  lastUsedEndpoint: z.string().nullable(),
  logs: z.array(
    z.object({
      timestamp: z.string(),
      ipAddress: z.string().nullable(),
      action: z.enum(['ISSUE_TOKEN', 'API_REQUEST']),
      endpoint: z.string().nullable(),
      status: z.enum(['SUCCESS', 'FAILED']),
      result: z.string(),
      reason: z.string().nullable().optional(),
    }),
  ),
});
