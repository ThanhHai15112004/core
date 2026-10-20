import { z } from 'zod';

export const resolvedCodeValueResponseSchema = z.object({
  typeCode: z.string(),
  numericCode: z.number().int(),
  code: z.string(),
  behaviorCode: z.string().nullable(),
  name: z.string(),
  displayLabel: z.string(),
  description: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  aliases: z.array(z.string()),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  isDefault: z.boolean(),
  isSystem: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  status: z.number().int(),
  statusName: z.enum(['ACTIVE', 'INACTIVE']),
});

export type ResolvedCodeValueResponse = z.infer<typeof resolvedCodeValueResponseSchema>;

export const codeTypeSummaryResponseSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  module: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  allowCustomValues: z.boolean(),
  status: z.number().int(),
  totalValues: z.number().int(),
  values: z.array(resolvedCodeValueResponseSchema).optional(),
});

export type CodeTypeSummaryResponse = z.infer<typeof codeTypeSummaryResponseSchema>;

export const bootstrapCodesResponseSchema = z.object({
  locale: z.string(),
  totalTypes: z.number().int(),
  dictionary: z.record(z.string(), z.array(resolvedCodeValueResponseSchema)),
});

export type BootstrapCodesResponse = z.infer<typeof bootstrapCodesResponseSchema>;

export const syncCodesResultResponseSchema = z.object({
  syncedModules: z.array(z.string()),
  totalCodeTypes: z.number().int(),
  createdTypesCount: z.number().int(),
  updatedTypesCount: z.number().int(),
  totalCodeValues: z.number().int(),
  createdValuesCount: z.number().int(),
  updatedValuesCount: z.number().int(),
});

export type SyncCodesResultResponse = z.infer<typeof syncCodesResultResponseSchema>;

export const codeValueUsageResponseSchema = z.object({
  typeCode: z.string(),
  numericCode: z.number().int(),
  code: z.string(),
  inUse: z.boolean(),
  totalUsageCount: z.number().int(),
  details: z.array(
    z.object({
      source: z.string(),
      count: z.number().int(),
    }),
  ),
});

export type CodeValueUsageResponse = z.infer<typeof codeValueUsageResponseSchema>;

export const bulkImportCodesResultResponseSchema = z.object({
  totalRows: z.number().int(),
  importedCount: z.number().int(),
  skippedCount: z.number().int(),
  failedCount: z.number().int(),
  importedCodes: z.array(z.string()),
  errors: z.array(
    z.object({
      row: z.number().int(),
      identifier: z.string(),
      message: z.string(),
    }),
  ),
});

export type BulkImportCodesResultResponse = z.infer<typeof bulkImportCodesResultResponseSchema>;

export const exportCodesResponseSchema = z.object({
  fileName: z.string(),
  contentType: z.string(),
  format: z.enum(['csv', 'xlsx']),
  totalExported: z.number().int(),
  csvContent: z.string(),
  xlsxBase64: z.string(),
});

export type ExportCodesResponse = z.infer<typeof exportCodesResponseSchema>;
