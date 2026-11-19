import { z } from 'zod';
import {
  booleanQueryParam,
  createPaginationQuerySchema,
  optionalQueryParam,
} from '@packages/http/index.js';
import {
  PROVIDER_HEALTH_STATUS,
  PROVIDER_ROLE,
  PROVIDER_STATUS,
  PROVIDER_TYPE,
  type ProviderHealthStatusCode,
  type ProviderRoleName,
  type ProviderStatusCode,
  type ProviderTypeName,
} from '@packages/kernel/index.js';

const PROVIDER_CODE_REGEX = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const DRIVER_CODE_REGEX = /^[a-z0-9][a-z0-9-_]{1,63}$/;

function parseProviderTypeInput(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'string') return val.trim().toUpperCase();
  return val;
}

function parseProviderRoleInput(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'string') return val.trim().toUpperCase();
  return val;
}

function parseProviderStatusInput(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim().toUpperCase();
    if (clean === '1' || clean === 'ACTIVE') return PROVIDER_STATUS.ACTIVE;
    if (clean === '2' || clean === 'PAUSED') return PROVIDER_STATUS.PAUSED;
    if (clean === '3' || clean === 'DISABLED') return PROVIDER_STATUS.DISABLED;
  }
  return val;
}

function parseProviderHealthStatusInput(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim().toUpperCase();
    if (clean === '0' || clean === 'UNKNOWN') return PROVIDER_HEALTH_STATUS.UNKNOWN;
    if (clean === '1' || clean === 'HEALTHY') return PROVIDER_HEALTH_STATUS.HEALTHY;
    if (clean === '2' || clean === 'DEGRADED') return PROVIDER_HEALTH_STATUS.DEGRADED;
    if (clean === '3' || clean === 'DOWN') return PROVIDER_HEALTH_STATUS.DOWN;
  }
  return val;
}

export const ProviderTypeSchema = z.preprocess(
  parseProviderTypeInput,
  z.enum([
    PROVIDER_TYPE.EMAIL,
    PROVIDER_TYPE.SMS,
    PROVIDER_TYPE.PAYMENT,
    PROVIDER_TYPE.STORAGE,
    PROVIDER_TYPE.IDENTITY,
  ]),
);

export const ProviderRoleSchema = z.preprocess(
  parseProviderRoleInput,
  z.enum([PROVIDER_ROLE.PRIMARY, PROVIDER_ROLE.FALLBACK, PROVIDER_ROLE.STANDBY]),
);

export const ProviderStatusSchema = z.preprocess(
  parseProviderStatusInput,
  z.union([
    z.literal(PROVIDER_STATUS.ACTIVE),
    z.literal(PROVIDER_STATUS.PAUSED),
    z.literal(PROVIDER_STATUS.DISABLED),
  ]),
);

export const ProviderHealthStatusSchema = z.preprocess(
  parseProviderHealthStatusInput,
  z.union([
    z.literal(PROVIDER_HEALTH_STATUS.UNKNOWN),
    z.literal(PROVIDER_HEALTH_STATUS.HEALTHY),
    z.literal(PROVIDER_HEALTH_STATUS.DEGRADED),
    z.literal(PROVIDER_HEALTH_STATUS.DOWN),
  ]),
);

export const CreateProviderEntryRequestSchema = z.object({
  providerType: ProviderTypeSchema,
  providerCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(PROVIDER_CODE_REGEX, 'providerCode must be 2-64 chars [a-z0-9-_]'),
  driverCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(DRIVER_CODE_REGEX, 'driverCode must be 2-64 chars [a-z0-9-_]'),
  displayName: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  domainRefCode: z.string().trim().max(64).nullable().optional(),
  httpServiceName: z.string().trim().max(80).nullable().optional(),
  role: ProviderRoleSchema.optional(),
  priority: z.coerce.number().int().min(1).max(10000).optional().default(100),
  isPrimary: z.boolean().optional().default(false),
  fallbackAllowed: z.boolean().optional().default(false),
  status: ProviderStatusSchema.optional().default(PROVIDER_STATUS.ACTIVE),
  secretRef: z.string().trim().max(160).nullable().optional(),
  secrets: z.record(z.string(), z.string()).optional(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  reason: z.string().trim().max(500).optional(),
});

export type CreateProviderEntryRequest = z.infer<typeof CreateProviderEntryRequestSchema>;

export const UpdateProviderEntryRequestSchema = z.object({
  driverCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(DRIVER_CODE_REGEX, 'driverCode must be 2-64 chars [a-z0-9-_]')
    .optional(),
  displayName: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  domainRefCode: z.string().trim().max(64).nullable().optional(),
  httpServiceName: z.string().trim().max(80).nullable().optional(),
  role: ProviderRoleSchema.optional(),
  priority: z.coerce.number().int().min(1).max(10000).optional(),
  isPrimary: z.boolean().optional(),
  fallbackAllowed: z.boolean().optional(),
  status: ProviderStatusSchema.optional(),
  secretRef: z.string().trim().max(160).nullable().optional(),
  secrets: z.record(z.string(), z.string()).optional(),
  clearSecrets: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().trim().max(500).optional(),
});

export type UpdateProviderEntryRequest = z.infer<typeof UpdateProviderEntryRequestSchema>;

export const SetPrimaryProviderRequestSchema = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z.object({
    reason: z.string().trim().max(500).optional(),
  }),
);

export type SetPrimaryProviderRequest = z.infer<typeof SetPrimaryProviderRequestSchema>;

export const PauseProviderRequestSchema = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z.object({
    reason: z.string().trim().max(500).optional(),
  }),
);

export type PauseProviderRequest = z.infer<typeof PauseProviderRequestSchema>;

export const ResumeProviderRequestSchema = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z.object({
    reason: z.string().trim().max(500).optional(),
  }),
);

export type ResumeProviderRequest = z.infer<typeof ResumeProviderRequestSchema>;

export const ResolveProviderPreviewRequestSchema = z.object({
  providerType: ProviderTypeSchema,
  organizationUnitId: z.coerce.number().int().positive().nullable().optional(),
  allowFallbackOverride: z.boolean().nullable().optional(),
});

export type ResolveProviderPreviewRequest = z.infer<typeof ResolveProviderPreviewRequestSchema>;

export const UpsertProviderUnitAssignmentRequestSchema = z.object({
  providerType: ProviderTypeSchema,
  organizationUnitId: z.coerce.number().int().positive(),
  primaryProviderId: z.coerce.number().int().positive(),
  fallbackProviderId: z.coerce.number().int().positive().nullable().optional(),
  allowFallbackOverride: z.boolean().nullable().optional(),
  isEnabled: z.boolean().optional().default(true),
  notes: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

export type UpsertProviderUnitAssignmentRequest = z.infer<
  typeof UpsertProviderUnitAssignmentRequestSchema
>;

export const RunHealthCheckAllRequestSchema = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z.object({
    providerType: ProviderTypeSchema.optional(),
  }),
);

export type RunHealthCheckAllRequest = z.infer<typeof RunHealthCheckAllRequestSchema>;

export const RecordProviderObservationRequestSchema = z.object({
  success: z.boolean(),
  latencyMs: z.coerce.number().min(0).max(300000),
  errorCode: z.string().trim().max(80).nullable().optional(),
  errorMessage: z.string().trim().max(500).nullable().optional(),
});

export type RecordProviderObservationRequest = z.infer<
  typeof RecordProviderObservationRequestSchema
>;

export const ListProviderEntriesQuerySchema = createPaginationQuerySchema().and(
  z.object({
    providerType: optionalQueryParam(ProviderTypeSchema) as z.ZodType<ProviderTypeName | undefined>,
    status: optionalQueryParam(ProviderStatusSchema) as z.ZodType<ProviderStatusCode | undefined>,
    healthStatus: optionalQueryParam(ProviderHealthStatusSchema) as z.ZodType<
      ProviderHealthStatusCode | undefined
    >,
    isPrimary: booleanQueryParam(),
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export type ListProviderEntriesQuery = z.infer<typeof ListProviderEntriesQuerySchema>;

export const ListProviderUnitAssignmentsQuerySchema = createPaginationQuerySchema().and(
  z.object({
    providerType: optionalQueryParam(ProviderTypeSchema) as z.ZodType<ProviderTypeName | undefined>,
    organizationUnitId: optionalQueryParam(z.coerce.number().int().positive()),
    isEnabled: booleanQueryParam(),
  }),
);

export type ListProviderUnitAssignmentsQuery = z.infer<
  typeof ListProviderUnitAssignmentsQuerySchema
>;

export const ListProviderHealthChecksQuerySchema = createPaginationQuerySchema().and(
  z.object({
    healthStatus: optionalQueryParam(ProviderHealthStatusSchema) as z.ZodType<
      ProviderHealthStatusCode | undefined
    >,
  }),
);

export type ListProviderHealthChecksQuery = z.infer<typeof ListProviderHealthChecksQuerySchema>;

export const ProviderDashboardQuerySchema = z.object({
  providerType: optionalQueryParam(ProviderTypeSchema) as z.ZodType<ProviderTypeName | undefined>,
  windowMinutes: optionalQueryParam(z.coerce.number().int().min(5).max(1440)),
});

export type ProviderDashboardQuery = z.infer<typeof ProviderDashboardQuerySchema>;

export const ListProviderConfigHistoriesQuerySchema = createPaginationQuerySchema().and(
  z.object({
    providerId: optionalQueryParam(z.coerce.number().int().positive()),
    providerType: optionalQueryParam(ProviderTypeSchema) as z.ZodType<ProviderTypeName | undefined>,
    providerCode: optionalQueryParam(z.string().trim().toLowerCase().max(64)),
    action: optionalQueryParam(z.string().trim().toUpperCase().max(32)),
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export type ListProviderConfigHistoriesQuery = z.infer<
  typeof ListProviderConfigHistoriesQuerySchema
>;

export type { ProviderRoleName };
