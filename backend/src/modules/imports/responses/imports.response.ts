import { z } from 'zod';
import { IMPORT_DUPLICATE_STRATEGY } from '@packages/kernel/index.js';
import type { BulkImportUsersResultResponse } from '@modules/users/index.js';

export const importCellIssueSchema = z.object({
  row: z.number().int().positive(),
  sheetRowNumber: z.number().int().positive(),
  column: z.string().nullable(),
  columnLetter: z.string().nullable(),
  field: z.string().nullable(),
  code: z.string(),
  value: z.unknown().optional(),
  message: z.string(),
});

export const importErrorItemSchema = z.object({
  row: z.number().int().positive(),
  sheetRowNumber: z.number().int().positive().optional(),
  identifier: z.string(),
  field: z.string().nullable().optional(),
  column: z.string().nullable().optional(),
  columnLetter: z.string().nullable().optional(),
  code: z.string().optional(),
  value: z.unknown().optional(),
  message: z.string(),
});

export const executeImportResultResponseSchema = z.object({
  totalRows: z.number().int().nonnegative(),
  importedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative().optional(),
  successCount: z.number().int().nonnegative().optional(),
  skippedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  remainingCount: z.number().int().nonnegative().optional(),
  duplicateStrategy: z
    .enum([
      IMPORT_DUPLICATE_STRATEGY.SKIP,
      IMPORT_DUPLICATE_STRATEGY.UPDATE,
      IMPORT_DUPLICATE_STRATEGY.REJECT,
    ])
    .optional(),
  historyId: z.number().int().positive().optional(),
  jobId: z.string().nullable().optional(),
  status: z
    .enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'])
    .optional(),
  importedUserIds: z.array(z.number().int().positive()).optional(),
  updatedUserIds: z.array(z.number().int().positive()).optional(),
  errors: z.array(importErrorItemSchema),
});

export type ExecuteImportResultResponse = BulkImportUsersResultResponse;

export const importPreviewResponseSchema = z.object({
  profileCode: z.string(),
  duplicateStrategy: z.enum([
    IMPORT_DUPLICATE_STRATEGY.SKIP,
    IMPORT_DUPLICATE_STRATEGY.UPDATE,
    IMPORT_DUPLICATE_STRATEGY.REJECT,
  ]),
  totalRows: z.number().int().nonnegative(),
  validRowsCount: z.number().int().nonnegative(),
  invalidRowsCount: z.number().int().nonnegative(),
  toCreateCount: z.number().int().nonnegative(),
  toUpdateCount: z.number().int().nonnegative(),
  toSkipCount: z.number().int().nonnegative(),
  toRejectCount: z.number().int().nonnegative(),
  mapping: z.object({
    headers: z.array(z.string()),
    matches: z.array(
      z.object({
        field: z.string(),
        header: z.string(),
        required: z.boolean(),
        matchedColumnIndex: z.number().int().nonnegative().nullable(),
        matchedColumnLetter: z.string().nullable(),
        matchedHeader: z.string().nullable(),
        source: z.enum(['explicit', 'auto', 'missing']),
      }),
    ),
    unmappedHeaders: z.array(z.string()),
    missingRequiredFields: z.array(z.string()),
  }),
  sampleRows: z.array(
    z.object({
      row: z.number().int().positive(),
      sheetRowNumber: z.number().int().positive(),
      status: z.enum([
        'VALID',
        'INVALID',
        'DUPLICATE_SKIP',
        'DUPLICATE_UPDATE',
        'DUPLICATE_REJECT',
      ]),
      action: z.enum(['CREATE', 'UPDATE', 'SKIP', 'REJECT']),
      rawValues: z.record(z.string(), z.string()),
      mappedData: z.record(z.string(), z.unknown()).nullable(),
      issues: z.array(importCellIssueSchema),
    }),
  ),
  issues: z.array(importCellIssueSchema),
});

export const importHistoryItemResponseSchema = z.object({
  id: z.number().int().positive(),
  jobId: z.string().nullable(),
  profileCode: z.string(),
  module: z.string(),
  fileName: z.string(),
  format: z.enum(['xlsx', 'csv', 'json']),
  duplicateStrategy: z.enum([
    IMPORT_DUPLICATE_STRATEGY.SKIP,
    IMPORT_DUPLICATE_STRATEGY.UPDATE,
    IMPORT_DUPLICATE_STRATEGY.REJECT,
  ]),
  columnMapping: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable(),
  actorId: z.number().int().positive().nullable(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED']),
  totalRows: z.number().int().nonnegative(),
  processedRows: z.number().int().nonnegative(),
  createdCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  remainingRows: z.number().int().nonnegative(),
  errors: z.array(importCellIssueSchema),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const importJobProgressResponseSchema = z.object({
  jobId: z.string(),
  historyId: z.number().int().positive().nullable(),
  profileCode: z.string(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED']),
  duplicateStrategy: z.enum([
    IMPORT_DUPLICATE_STRATEGY.SKIP,
    IMPORT_DUPLICATE_STRATEGY.UPDATE,
    IMPORT_DUPLICATE_STRATEGY.REJECT,
  ]),
  totalRows: z.number().int().nonnegative(),
  processedRows: z.number().int().nonnegative(),
  successRows: z.number().int().nonnegative(),
  createdRows: z.number().int().nonnegative(),
  updatedRows: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(),
  failedRows: z.number().int().nonnegative(),
  remainingRows: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const importTemplateFileResponseSchema = z.object({
  fileName: z.string(),
  contentType: z.string(),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  totalExported: z.number().int().nonnegative(),
  csvContent: z.string(),
  xlsxBase64: z.string(),
});
