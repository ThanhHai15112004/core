import { z } from 'zod';

export const executeExportResponseSchema = z.object({
  fileName: z.string(),
  contentType: z.string(),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  totalExported: z.number().int().nonnegative(),
  csvContent: z.string(),
  xlsxBase64: z.string(),
  pdfBase64: z.string().optional(),
  historyId: z.number().int().positive().optional(),
  jobId: z.string().nullable().optional(),
  status: z
    .enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'])
    .optional(),
  downloadToken: z.string().nullable().optional(),
  downloadUrl: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  maxRowsApplied: z.number().int().positive().optional(),
  filtersApplied: z.record(z.string(), z.unknown()).optional(),
  notifiedAt: z.string().nullable().optional(),
});

export type ExecuteExportResponse = z.infer<typeof executeExportResponseSchema>;

export const exportHistoryItemResponseSchema = z.object({
  id: z.number().int().positive(),
  jobId: z.string().nullable(),
  profileCode: z.string(),
  module: z.string(),
  fileName: z.string(),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  actorId: z.number().int().positive().nullable(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']),
  filters: z.record(z.string(), z.unknown()),
  totalExported: z.number().int().nonnegative(),
  processedRows: z.number().int().nonnegative(),
  maxRowsApplied: z.number().int().positive(),
  downloadToken: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
  isExpired: z.boolean(),
  notifiedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export const exportJobProgressResponseSchema = z.object({
  jobId: z.string(),
  historyId: z.number().int().positive().nullable(),
  profileCode: z.string(),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']),
  totalRows: z.number().int().nonnegative(),
  processedRows: z.number().int().nonnegative(),
  remainingRows: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  downloadToken: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
  notifiedAt: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const exportTemporaryDownloadResponseSchema = z.object({
  token: z.string(),
  downloadUrl: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  totalExported: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
  expiresAt: z.string(),
  csvContent: z.string().optional(),
  xlsxBase64: z.string().optional(),
  pdfBase64: z.string().optional(),
});
