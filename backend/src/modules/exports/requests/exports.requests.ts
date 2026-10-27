import { z } from 'zod';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';
import { listUsersQuerySchema } from '@modules/users/index.js';

export const executeExportQuerySchema = listUsersQuerySchema;
export type ExecuteExportQuery = z.infer<typeof executeExportQuerySchema>;

export const listExportHistoriesQuerySchema = z.object({
  profileCode: optionalQueryParam(z.string().trim().min(1).max(64)),
  module: optionalQueryParam(z.string().trim().min(1).max(64)),
  actorId: optionalQueryParam(z.coerce.number().int().positive()),
  format: optionalQueryParam(z.enum(['csv', 'xlsx', 'pdf'])),
  status: optionalQueryParam(
    z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']),
  ),
  includeExpired: optionalQueryParam(booleanQueryParam()),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)),
});

export type ListExportHistoriesQuery = z.infer<typeof listExportHistoriesQuerySchema>;

export const updateExportHistoryRequestSchema = z.object({
  status: z
    .enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'])
    .optional(),
  fileName: z.string().trim().min(1).max(255).optional(),
  totalExported: z.number().int().nonnegative().optional(),
  processedRows: z.number().int().nonnegative().optional(),
  isExpired: z.boolean().optional(),
  errorMessage: z.string().nullable().optional(),
});

export type UpdateExportHistoryRequest = z.infer<typeof updateExportHistoryRequestSchema>;
