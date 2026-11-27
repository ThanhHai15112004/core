import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';
import {
  DEFAULT_SCIM_CLIENT_SCOPES,
  SCIM_CLIENT_STATUS,
  SCIM_DEPROVISION_MODE,
  SCIM_RECONCILIATION_MODE,
  SCIM_SYNC_OUTCOME,
} from '../enum/identity-provisioning.enum.js';

export const clientIdParamSchema = z.object({
  id: z.coerce.number().int().min(1),
});

export const scimResourceIdParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

const roleCodeListSchema = z.array(z.string().trim().min(1).max(64)).max(100);

const groupRoleMappingsSchema = z.record(z.string().trim().min(1).max(255), roleCodeListSchema);

export const CreateScimClientRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'SCIM client code must be lowercase kebab-case'),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  federatedProviderCode: z.string().trim().max(64).nullable().optional(),
  status: z
    .union([z.literal(SCIM_CLIENT_STATUS.ACTIVE), z.literal(SCIM_CLIENT_STATUS.INACTIVE)])
    .optional()
    .default(SCIM_CLIENT_STATUS.ACTIVE),
  allowedIps: z.array(z.string().trim().min(1).max(64)).max(100).optional().default([]),
  scopes: z
    .array(z.string().trim().min(1).max(64))
    .max(20)
    .optional()
    .default([...DEFAULT_SCIM_CLIENT_SCOPES]),
  deprovisionMode: z
    .enum([SCIM_DEPROVISION_MODE.LOCK_AND_REVOKE, SCIM_DEPROVISION_MODE.DEACTIVATE_AND_REVOKE])
    .optional()
    .default(SCIM_DEPROVISION_MODE.LOCK_AND_REVOKE),
  groupRoleMappings: groupRoleMappingsSchema.optional().default({}),
  allowedRoleCodes: roleCodeListSchema.optional().default([]),
  deniedRoleCodes: roleCodeListSchema.optional().default([]),
  defaultRoleCodes: roleCodeListSchema.optional().default([]),
  requireIfMatch: z.boolean().optional().default(false),
});

export type CreateScimClientRequest = z.infer<typeof CreateScimClientRequestSchema>;

export const UpdateScimClientRequestSchema = CreateScimClientRequestSchema.omit({
  code: true,
}).partial();

export type UpdateScimClientRequest = z.infer<typeof UpdateScimClientRequestSchema>;

export const ListScimDirectoryQuerySchema = z.object({
  clientId: optionalQueryParam(intQueryParam({ min: 1 })),
  active: optionalQueryParam(booleanQueryParam()),
  search: optionalQueryParam(z.string().trim().max(200)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});

export type ListScimDirectoryQuery = z.infer<typeof ListScimDirectoryQuerySchema>;

export const ListScimSyncLogsQuerySchema = z.object({
  clientId: optionalQueryParam(intQueryParam({ min: 1 })),
  resourceType: optionalQueryParam(z.string().trim().max(32)),
  outcome: optionalQueryParam(
    z.enum([
      SCIM_SYNC_OUTCOME.SUCCESS,
      SCIM_SYNC_OUTCOME.NOOP_DUPLICATE,
      SCIM_SYNC_OUTCOME.CONFLICT,
      SCIM_SYNC_OUTCOME.FAILED,
    ]),
  ),
  operation: optionalQueryParam(z.string().trim().max(40)),
  externalId: optionalQueryParam(z.string().trim().max(255)),
  search: optionalQueryParam(z.string().trim().max(200)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});

export type ListScimSyncLogsQuery = z.infer<typeof ListScimSyncLogsQuerySchema>;

export const ScimListQuerySchema = z.object({
  filter: optionalQueryParam(z.string().trim().max(1000)),
  startIndex: optionalQueryParam(intQueryParam({ min: 1 })),
  count: optionalQueryParam(intQueryParam({ min: 0, max: 500 })),
});

export type ScimListQuery = z.infer<typeof ScimListQuerySchema>;

export const ScimPatchOperationSchema = z.object({
  op: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['add', 'replace', 'remove']),
  ),
  path: z.string().trim().optional(),
  value: z.unknown().optional(),
});

export const ScimPatchBodySchema = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z.array(ScimPatchOperationSchema).min(1),
});

export type ScimPatchBodyInput = z.infer<typeof ScimPatchBodySchema>;

export const IdpUserSnapshotItemSchema = z.object({
  externalId: z.string().trim().min(1).max(255),
  userName: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(255),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(150).optional(),
  fullName: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  active: z.boolean(),
});

export const IdpGroupSnapshotItemSchema = z.object({
  externalId: z.string().trim().max(255).optional(),
  displayName: z.string().trim().min(1).max(255),
  memberExternalIds: z.array(z.string().trim().min(1).max(255)).default([]),
});

export const RunScimReconciliationRequestSchema = z.object({
  mode: z
    .enum([SCIM_RECONCILIATION_MODE.DRY_RUN, SCIM_RECONCILIATION_MODE.APPLY])
    .optional()
    .default(SCIM_RECONCILIATION_MODE.DRY_RUN),
  applyDeprovisionOrphans: z.boolean().optional().default(true),
  applySyncMissingAndDrifts: z.boolean().optional().default(true),
  idpUsers: z.array(IdpUserSnapshotItemSchema).max(5000),
  idpGroups: z.array(IdpGroupSnapshotItemSchema).max(1000).optional().default([]),
});

export type RunScimReconciliationRequest = z.infer<typeof RunScimReconciliationRequestSchema>;

export const ListScimReconciliationsQuerySchema = z.object({
  clientId: optionalQueryParam(intQueryParam({ min: 1 })),
  mode: optionalQueryParam(
    z.enum([SCIM_RECONCILIATION_MODE.DRY_RUN, SCIM_RECONCILIATION_MODE.APPLY]),
  ),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});

export type ListScimReconciliationsQuery = z.infer<typeof ListScimReconciliationsQuerySchema>;
