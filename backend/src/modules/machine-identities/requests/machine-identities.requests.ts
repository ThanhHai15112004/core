import { z } from 'zod';

// ============================================================================
// MỤC 3.6: TÀI KHOẢN HỆ THỐNG (SERVICE ACCOUNT) & API CLIENT
// ============================================================================

export const createServiceAccountSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Service account code must be alphanumeric / slug'),
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).nullable().optional(),
  scopes: z.array(z.string().trim().min(1).max(128)).max(200).optional().default([]),
  status: z
    .union([z.number().int().min(1).max(3), z.enum(['ACTIVE', 'INACTIVE', 'REVOKED'])])
    .optional(),
});

export type CreateServiceAccountRequest = z.infer<typeof createServiceAccountSchema>;

export const updateServiceAccountSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  scopes: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
  status: z
    .union([z.number().int().min(1).max(3), z.enum(['ACTIVE', 'INACTIVE', 'REVOKED'])])
    .optional(),
});

export type UpdateServiceAccountRequest = z.infer<typeof updateServiceAccountSchema>;

export const createApiClientSchema = z.object({
  serviceAccountId: z.number().int().min(1),
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).nullable().optional(),
  scopes: z.array(z.string().trim().min(1).max(128)).min(1).max(200),
  allowedIps: z.array(z.string().trim().min(1).max(64)).max(100).optional().default([]),
});

export type CreateApiClientRequest = z.infer<typeof createApiClientSchema>;

export const updateApiClientScopesSchema = z.object({
  scopes: z.array(z.string().trim().min(1).max(128)).min(1).max(200),
});

export type UpdateApiClientScopesRequest = z.infer<typeof updateApiClientScopesSchema>;

export const updateApiClientAllowedIpsSchema = z.object({
  allowedIps: z.array(z.string().trim().min(1).max(64)).max(100),
});

export type UpdateApiClientAllowedIpsRequest = z.infer<typeof updateApiClientAllowedIpsSchema>;

export const rotateApiClientSecretSchema = z
  .object({
    revokeExistingTokens: z.boolean().optional().default(true),
    reason: z.string().trim().max(255).optional(),
  })
  .default({ revokeExistingTokens: true });

export type RotateApiClientSecretRequest = z.infer<typeof rotateApiClientSecretSchema>;

export const revokeApiClientSchema = z
  .object({
    reason: z.string().trim().max(255).optional(),
  })
  .default({});

export type RevokeApiClientRequest = z.infer<typeof revokeApiClientSchema>;

export const issueApiClientTokenSchema = z.object({
  clientId: z.string().trim().min(4).max(128),
  clientSecret: z.string().min(8).max(256),
  scopes: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
  expiresInSeconds: z.number().int().min(60).max(86_400).optional(),
});

export type IssueApiClientTokenRequest = z.infer<typeof issueApiClientTokenSchema>;

export const listApiClientsQuerySchema = z
  .object({
    serviceAccountId: z.coerce.number().int().min(1).optional(),
  })
  .default({});

export type ListApiClientsQuery = z.infer<typeof listApiClientsQuerySchema>;
