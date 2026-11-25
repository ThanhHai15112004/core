import { z } from 'zod';
import {
  booleanQueryParam,
  createPaginationQuerySchema,
  optionalQueryParam,
} from '@packages/http/index.js';
import {
  IDEMPOTENCY_DEFAULTS,
  parseIdempotencyScope,
  parseIdempotencyStatus,
} from '../enum/idempotency.enum.js';

const optionalScopeSchema = optionalQueryParam(
  z.string().transform((val, ctx) => {
    const parsed = parseIdempotencyScope(val);
    if (parsed === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid idempotency scope (expected API, JOB, WEBHOOK, EVENT)',
      });
      return z.NEVER;
    }
    return parsed;
  }),
);

const optionalStatusSchema = optionalQueryParam(
  z.union([z.number(), z.string()]).transform((val, ctx) => {
    const parsed = parseIdempotencyStatus(val);
    if (parsed === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid idempotency status (expected 1..3 or IN_PROGRESS/COMPLETED/FAILED)',
      });
      return z.NEVER;
    }
    return parsed;
  }),
);

export const ListIdempotencyRecordsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
}).and(
  z.object({
    scope: optionalScopeSchema,
    scopeTarget: optionalQueryParam(z.string().trim().min(1).max(200)),
    status: optionalStatusSchema,
    clientIdentifier: optionalQueryParam(z.string().trim().min(1).max(160)),
    correlationId: optionalQueryParam(z.string().trim().min(1).max(120)),
    onlyDuplicates: booleanQueryParam(),
    onlyConflicts: booleanQueryParam(),
    includeExpired: booleanQueryParam(),
    search: optionalQueryParam(z.string().trim().min(1).max(200)),
  }),
);

export type ListIdempotencyRecordsQuery = z.infer<typeof ListIdempotencyRecordsQuerySchema>;

export const IdempotencyMetricsQuerySchema = z.object({
  windowHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(720)
    .optional()
    .default(IDEMPOTENCY_DEFAULTS.DEFAULT_METRICS_WINDOW_HOURS),
});

export type IdempotencyMetricsQuery = z.infer<typeof IdempotencyMetricsQuerySchema>;

export const PurgeIdempotencyRequestSchema = z.object({
  batchSize: z.coerce.number().int().min(50).max(10_000).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

export type PurgeIdempotencyRequest = z.infer<typeof PurgeIdempotencyRequestSchema>;

export const RevokeIdempotencyQuerySchema = z.object({
  reason: optionalQueryParam(z.string().trim().min(3).max(500)),
});

export type RevokeIdempotencyQuery = z.infer<typeof RevokeIdempotencyQuerySchema>;
