import { z } from 'zod';
import { IMPORT_DUPLICATE_STRATEGY } from '@packages/kernel/index.js';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';

export const importColumnMappingInputSchema = z.record(
  z.string().trim().min(1),
  z.union([z.string().trim().min(1), z.number().int().min(0), z.null()]),
);

export const importDuplicateStrategyInputSchema = z.enum([
  IMPORT_DUPLICATE_STRATEGY.SKIP,
  IMPORT_DUPLICATE_STRATEGY.UPDATE,
  IMPORT_DUPLICATE_STRATEGY.REJECT,
]);

export const executeImportRequestSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).max(5000).optional(),
  csvContent: z.string().trim().min(1).optional(),
  xlsxBase64: z.string().trim().min(1).optional(),
  fileName: z.string().trim().max(255).optional(),
  columnMapping: importColumnMappingInputSchema.optional(),
  duplicateStrategy: importDuplicateStrategyInputSchema.optional(),
  skipDuplicates: z.boolean().optional().default(true),
  defaultPassword: z.string().min(8).max(72).optional(),
  async: z.boolean().optional().default(false),
});

export type ExecuteImportRequest = z.infer<typeof executeImportRequestSchema>;

export const previewImportRequestSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).max(5000).optional(),
  csvContent: z.string().trim().min(1).optional(),
  xlsxBase64: z.string().trim().min(1).optional(),
  columnMapping: importColumnMappingInputSchema.optional(),
  duplicateStrategy: importDuplicateStrategyInputSchema.optional(),
  skipDuplicates: z.boolean().optional().default(true),
  previewLimit: z.number().int().min(1).max(100).optional().default(20),
});

export type PreviewImportRequest = z.infer<typeof previewImportRequestSchema>;

export const listImportHistoriesQuerySchema = z.object({
  profileCode: optionalQueryParam(z.string().trim().min(1).max(64)),
  module: optionalQueryParam(z.string().trim().min(1).max(64)),
  actorId: optionalQueryParam(z.coerce.number().int().positive()),
  status: optionalQueryParam(z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED'])),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)),
});

export type ListImportHistoriesQuery = z.infer<typeof listImportHistoriesQuerySchema>;

export const importTemplateQuerySchema = z.object({
  format: optionalQueryParam(z.enum(['csv', 'xlsx'])),
  includeSamples: optionalQueryParam(booleanQueryParam()),
});

export type ImportTemplateQuery = z.infer<typeof importTemplateQuerySchema>;

export const updateImportHistoryRequestSchema = z.object({
  status: z
    .enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'])
    .optional(),
  fileName: z.string().trim().min(1).max(255).optional(),
  totalRows: z.number().int().nonnegative().optional(),
  processedRows: z.number().int().nonnegative().optional(),
  createdCount: z.number().int().nonnegative().optional(),
  updatedCount: z.number().int().nonnegative().optional(),
  skippedCount: z.number().int().nonnegative().optional(),
  failedCount: z.number().int().nonnegative().optional(),
  completedAt: z.string().nullable().optional(),
});

export type UpdateImportHistoryRequest = z.infer<typeof updateImportHistoryRequestSchema>;
