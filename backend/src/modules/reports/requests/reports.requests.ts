import { z } from 'zod';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';
import { createUserReportScheduleSchema, runUserReportSchema } from '@modules/users/index.js';

export const runReportRequestSchema = runUserReportSchema;
export type RunReportRequest = z.infer<typeof runReportRequestSchema>;

export const createReportScheduleRequestSchema = createUserReportScheduleSchema;
export type CreateReportScheduleRequest = z.infer<typeof createReportScheduleRequestSchema>;

export const updateReportScheduleRequestSchema = createUserReportScheduleSchema.partial();
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
