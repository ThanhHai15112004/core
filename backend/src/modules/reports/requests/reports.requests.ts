import { z } from 'zod';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';

const coercePositiveInt = z.coerce.number().int().min(1);
const reportStatusInputSchema = z.union([
  z.coerce.number().int().min(1).max(4) as z.ZodType<1 | 2 | 3 | 4>,
  z.string().trim().min(1).max(32),
]);

export const reportParametersInputSchema = z.object({
  fromDate: z.string().trim().max(64).nullable().optional(),
  toDate: z.string().trim().max(64).nullable().optional(),
  status: z
    .union([reportStatusInputSchema, z.array(reportStatusInputSchema)])
    .nullable()
    .optional(),
  organizationUnitId: coercePositiveInt.nullable().optional(),
  includeSubUnits: z.boolean().optional(),
  filters: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const runReportRequestSchema = z.object({
  reportCode: z.string().trim().min(1).max(120).default('users.summary_dashboard'),
  fromDate: z.string().trim().max(64).nullable().optional(),
  toDate: z.string().trim().max(64).nullable().optional(),
  status: z
    .union([reportStatusInputSchema, z.array(reportStatusInputSchema)])
    .nullable()
    .optional(),
  organizationUnitId: coercePositiveInt.nullable().optional(),
  includeSubUnits: z.boolean().optional(),
  filters: z.record(z.string(), z.unknown()).nullable().optional(),
  parameters: reportParametersInputSchema.optional(),
  format: z.enum(['csv', 'xlsx', 'pdf']).optional(),
  async: z.boolean().optional(),
  useCache: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
  preferReplica: z.boolean().optional(),
  ttlSeconds: z.number().int().min(1).max(604800).optional(),
  notifyChannels: z.array(z.enum(['EMAIL', 'IN_APP'])).optional(),
  recipientEmails: z.array(z.string().trim().email()).optional(),
  recipientUserIds: z.array(coercePositiveInt).optional(),
});
export type RunReportRequest = z.infer<typeof runReportRequestSchema>;

export const createReportScheduleRequestSchema = z.object({
  reportCode: z.string().trim().min(1).max(120).default('users.summary_dashboard'),
  name: z.string().trim().min(2).max(200),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  cronExpression: z.string().trim().min(5).max(64).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx'),
  parameters: reportParametersInputSchema.optional(),
  channels: z
    .array(z.enum(['EMAIL', 'IN_APP']))
    .min(1)
    .default(['EMAIL', 'IN_APP']),
  recipientEmails: z.array(z.string().trim().email()).optional().default([]),
  recipientUserIds: z.array(coercePositiveInt).optional().default([]),
  ttlSeconds: z.number().int().min(60).max(604800).optional().default(3600),
  isActive: z.boolean().optional().default(true),
});
export type CreateReportScheduleRequest = z.infer<typeof createReportScheduleRequestSchema>;

export const updateReportScheduleRequestSchema = createReportScheduleRequestSchema.partial();
export type UpdateReportScheduleRequest = z.infer<typeof updateReportScheduleRequestSchema>;

export const listReportsQuerySchema = z.object({
  module: optionalQueryParam(z.string().trim().min(1).max(64)),
  category: optionalQueryParam(z.enum(['REPORT', 'DASHBOARD'])),
  includeAllModules: optionalQueryParam(booleanQueryParam()),
});

export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

export const listReportSchedulesQuerySchema = z.object({
  module: optionalQueryParam(z.string().trim().min(1).max(64)),
  reportCode: optionalQueryParam(z.string().trim().min(1).max(128)),
  frequency: optionalQueryParam(z.enum(['DAILY', 'WEEKLY', 'MONTHLY'])),
  isActive: optionalQueryParam(booleanQueryParam()),
});

export type ListReportSchedulesQuery = z.infer<typeof listReportSchedulesQuerySchema>;

export const listReportHistoriesQuerySchema = z.object({
  module: optionalQueryParam(z.string().trim().min(1).max(64)),
  reportCode: optionalQueryParam(z.string().trim().min(1).max(128)),
  actorId: optionalQueryParam(z.coerce.number().int().positive()),
  status: optionalQueryParam(z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'])),
  executionMode: optionalQueryParam(z.enum(['SYNC', 'QUEUE', 'SCHEDULED'])),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)),
});

export type ListReportHistoriesQuery = z.infer<typeof listReportHistoriesQuerySchema>;
