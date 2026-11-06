import { z } from 'zod';
import {
  booleanQueryParam,
  intQueryParam,
  optionalQueryParam,
  parseSelectFields,
} from '@packages/http/index.js';

export const executeExportQuerySchema = z.object({
  q: optionalQueryParam(z.string().trim().max(200)),
  search: optionalQueryParam(z.string().trim().max(200)),
  status: optionalQueryParam(z.coerce.number().int().min(1).max(4) as z.ZodType<1 | 2 | 3 | 4>),
  roleId: optionalQueryParam(intQueryParam({ min: 1 })),
  organizationUnitId: optionalQueryParam(intQueryParam({ min: 1 })),
  managerId: optionalQueryParam(intQueryParam({ min: 1 })),
  includeArchived: optionalQueryParam(booleanQueryParam()),
  mfaEnabled: optionalQueryParam(booleanQueryParam()),
  createdFrom: optionalQueryParam(z.string().trim().max(64)),
  createdTo: optionalQueryParam(z.string().trim().max(64)),
  fromDate: optionalQueryParam(z.string().trim().max(64)),
  toDate: optionalQueryParam(z.string().trim().max(64)),
  customFieldFilters: optionalQueryParam(z.string().trim().max(2000)),
  fields: optionalQueryParam(
    z.preprocess(
      (v) => parseSelectFields(v as string | readonly string[] | undefined),
      z.array(z.string()).optional(),
    ),
  ),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 5000 })),
  countMode: optionalQueryParam(z.enum(['exact', 'estimated', 'none'])),
  sort: optionalQueryParam(z.string().trim().max(200)),
  sortBy: optionalQueryParam(
    z.enum(['id', 'createdAt', 'firstName', 'lastName', 'fullName', 'email', 'username', 'status']),
  ).default('id'),
  sortOrder: optionalQueryParam(
    z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
      z.enum(['ASC', 'DESC']),
    ),
  ).default('ASC'),
  format: optionalQueryParam(z.enum(['csv', 'xlsx', 'pdf'])),
  title: optionalQueryParam(z.string().trim().max(160)),
  logoBase64: optionalQueryParam(z.string().max(500_000)),
  async: optionalQueryParam(booleanQueryParam()),
  notifyOnComplete: optionalQueryParam(booleanQueryParam()),
  ttlSeconds: optionalQueryParam(intQueryParam({ min: 1, max: 604800 })),
  enforceStrictLimit: optionalQueryParam(booleanQueryParam()),
  onlyRequestedFormat: optionalQueryParam(booleanQueryParam()),
  stepUpToken: optionalQueryParam(z.string().trim().min(10)),
  requireStepUp: optionalQueryParam(booleanQueryParam()),
});
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
