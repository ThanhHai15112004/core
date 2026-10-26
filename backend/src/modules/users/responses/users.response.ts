import { z } from 'zod';
import type {
  UserOrganizationAssignmentSummary,
  UserProfileView,
  UserRoleAssignmentSummary,
  UserStatusCode,
  UserStatusName,
} from '../contracts/index.js';

export interface UserResponse {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly phone: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly avatarUrl: string | null;
  readonly preferredLocale?: string;
  readonly preferredTimezone?: string;
  readonly profile: UserProfileView;
  readonly status: UserStatusCode;
  readonly statusName: UserStatusName;
  readonly emailVerifiedAt: string | null;
  readonly phoneVerifiedAt: string | null;
  readonly lockedUntil: string | null;
  readonly lockReason: string | null;
  readonly failedLoginAttempts: number;
  readonly mfaEnabled: boolean;
  readonly primaryOrganizationUnitId: number | null;
  readonly managerId?: number | null;
  readonly roles: readonly UserRoleAssignmentSummary[];
  readonly organizationUnits: readonly UserOrganizationAssignmentSummary[];
  readonly lastLoginAt: string | null;
  readonly passwordChangedAt: string | null;
  readonly archivedAt: string | null;
  readonly isArchived: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserStatusHistoryItemResponse {
  readonly id: number;
  readonly userId: number;
  readonly fromStatus: UserStatusCode | null;
  readonly fromStatusName: UserStatusName | null;
  readonly toStatus: UserStatusCode;
  readonly toStatusName: UserStatusName;
  readonly reason: string | null;
  readonly changedBy: number | null;
  readonly createdAt: string;
}

export interface BulkImportUsersErrorItem {
  readonly row: number;
  readonly sheetRowNumber?: number;
  readonly identifier: string;
  readonly field?: string | null;
  readonly column?: string | null;
  readonly columnLetter?: string | null;
  readonly code?: string;
  readonly value?: unknown;
  readonly message: string;
}

export interface BulkImportUsersResultResponse {
  readonly totalRows: number;
  readonly importedCount: number;
  readonly updatedCount?: number;
  readonly successCount?: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly remainingCount?: number;
  readonly duplicateStrategy?: 'SKIP' | 'UPDATE' | 'REJECT';
  readonly historyId?: number;
  readonly jobId?: string | null;
  readonly status?: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  readonly importedUserIds: readonly number[];
  readonly updatedUserIds?: readonly number[];
  readonly errors: ReadonlyArray<BulkImportUsersErrorItem>;
}

export interface ExportUsersCsvResponse {
  readonly fileName: string;
  readonly contentType: string;
  readonly format: 'csv' | 'xlsx' | 'pdf';
  readonly totalExported: number;
  readonly csvContent: string;
  readonly xlsxBase64: string;
  readonly pdfBase64?: string;
  readonly historyId?: number;
  readonly jobId?: string | null;
  readonly status?: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  readonly downloadToken?: string | null;
  readonly downloadUrl?: string | null;
  readonly expiresAt?: string | null;
  readonly maxRowsApplied?: number;
  readonly filtersApplied?: Readonly<Record<string, unknown>>;
  readonly notifiedAt?: string | null;
}

export const userRoleSummarySchema = z.object({
  roleId: z.number().int().min(1),
  code: z.string(),
  name: z.string(),
  dataScope: z.number().int().min(1).max(4).optional(),
  dataScopeName: z.string().optional(),
});

export const userOrganizationSummarySchema = z.object({
  organizationUnitId: z.number().int().min(1),
  code: z.string().optional(),
  name: z.string().optional(),
  type: z.number().int().optional(),
  typeName: z.string().optional(),
  isPrimary: z.boolean(),
  positionTitle: z.string().nullable(),
});

export const userProfileResponseSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  avatarUrl: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  gender: z.number().int().nullable(),
  identityNumber: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  bio: z.string().nullable(),
  preferredLocale: z.string().optional(),
  preferredTimezone: z.string().optional(),
});

export const userResponseSchema = z.object({
  id: z.number().int().min(1),
  username: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  avatarUrl: z.string().nullable(),
  preferredLocale: z.string().optional(),
  preferredTimezone: z.string().optional(),
  profile: userProfileResponseSchema,
  status: z.number().int().min(1).max(4),
  statusName: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED', 'ARCHIVED']),
  emailVerifiedAt: z.string().nullable(),
  phoneVerifiedAt: z.string().nullable(),
  lockedUntil: z.string().nullable(),
  lockReason: z.string().nullable(),
  failedLoginAttempts: z.number(),
  mfaEnabled: z.boolean(),
  primaryOrganizationUnitId: z.number().int().min(1).nullable(),
  managerId: z.number().int().min(1).nullable().optional(),
  roles: z.array(userRoleSummarySchema),
  organizationUnits: z.array(userOrganizationSummarySchema),
  lastLoginAt: z.string().nullable(),
  passwordChangedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  isArchived: z.boolean(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const userStatusHistoryItemSchema = z.object({
  id: z.number().int().min(1),
  userId: z.number().int().min(1),
  fromStatus: z.number().int().min(1).max(4).nullable(),
  fromStatusName: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED', 'ARCHIVED']).nullable(),
  toStatus: z.number().int().min(1).max(4),
  toStatusName: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED', 'ARCHIVED']),
  reason: z.string().nullable(),
  changedBy: z.number().int().min(1).nullable(),
  createdAt: z.string(),
});

export const bulkImportErrorItemSchema = z.object({
  row: z.number(),
  sheetRowNumber: z.number().optional(),
  identifier: z.string(),
  field: z.string().nullable().optional(),
  column: z.string().nullable().optional(),
  columnLetter: z.string().nullable().optional(),
  code: z.string().optional(),
  value: z.unknown().optional(),
  message: z.string(),
});

export const bulkImportUsersResultSchema = z.object({
  totalRows: z.number(),
  importedCount: z.number(),
  updatedCount: z.number().optional(),
  successCount: z.number().optional(),
  skippedCount: z.number(),
  failedCount: z.number(),
  remainingCount: z.number().optional(),
  duplicateStrategy: z.enum(['SKIP', 'UPDATE', 'REJECT']).optional(),
  historyId: z.number().optional(),
  jobId: z.string().nullable().optional(),
  status: z
    .enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'])
    .optional(),
  importedUserIds: z.array(z.number().int().min(1)),
  updatedUserIds: z.array(z.number().int().min(1)).optional(),
  errors: z.array(bulkImportErrorItemSchema),
});

export const importCellIssueSchema = z.object({
  row: z.number(),
  sheetRowNumber: z.number(),
  column: z.string().nullable(),
  columnLetter: z.string().nullable(),
  field: z.string().nullable(),
  code: z.string(),
  value: z.unknown().optional(),
  message: z.string(),
});

export const importUsersPreviewResponseSchema = z.object({
  profileCode: z.string(),
  detectedHeaders: z.array(z.string()),
  headerRowIndex: z.number(),
  columnMatches: z.array(
    z.object({
      field: z.string(),
      header: z.string(),
      required: z.boolean(),
      matchedIndex: z.number(),
      matchedHeader: z.string().nullable(),
      matchedColumnLetter: z.string().nullable(),
      mappedBy: z.enum(['custom', 'alias', 'unmapped']),
    }),
  ),
  unmappedRequiredFields: z.array(z.string()),
  totalRows: z.number(),
  validRowsCount: z.number(),
  invalidRowsCount: z.number(),
  duplicateRowsCount: z.number(),
  willCreateCount: z.number(),
  willUpdateCount: z.number(),
  willSkipCount: z.number(),
  willRejectCount: z.number(),
  duplicateStrategy: z.enum(['SKIP', 'UPDATE', 'REJECT']),
  sampleRows: z.array(
    z.object({
      row: z.number(),
      sheetRowNumber: z.number(),
      rawValues: z.record(z.string(), z.string()),
      parsedRow: z.record(z.string(), z.unknown()).nullable(),
      status: z.enum([
        'VALID',
        'DUPLICATE_SKIP',
        'DUPLICATE_UPDATE',
        'DUPLICATE_REJECT',
        'INVALID',
      ]),
      existingRecordId: z.union([z.number(), z.string()]).nullable(),
      issues: z.array(importCellIssueSchema),
    }),
  ),
  issues: z.array(importCellIssueSchema),
});

export const importJobProgressResponseSchema = z.object({
  jobId: z.string(),
  profileCode: z.string(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']),
  totalRows: z.number(),
  processedRows: z.number(),
  remainingRows: z.number(),
  successCount: z.number(),
  createdCount: z.number(),
  updatedCount: z.number(),
  skippedCount: z.number(),
  failedCount: z.number(),
  percent: z.number(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const importHistoryItemResponseSchema = z.object({
  id: z.number(),
  jobId: z.string().nullable(),
  profileCode: z.string(),
  module: z.string(),
  fileName: z.string(),
  format: z.enum(['csv', 'xlsx', 'json']),
  duplicateStrategy: z.enum(['SKIP', 'UPDATE', 'REJECT']),
  actorId: z.number().nullable(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']),
  totalRows: z.number(),
  processedRows: z.number(),
  remainingRows: z.number(),
  successCount: z.number(),
  createdCount: z.number(),
  updatedCount: z.number(),
  skippedCount: z.number(),
  failedCount: z.number(),
  errors: z.array(importCellIssueSchema),
  columnMapping: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export const exportUsersCsvResponseSchema = z.object({
  fileName: z.string(),
  contentType: z.string(),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  totalExported: z.number(),
  csvContent: z.string(),
  xlsxBase64: z.string(),
  pdfBase64: z.string().optional(),
  historyId: z.number().optional(),
  jobId: z.string().nullable().optional(),
  status: z
    .enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'])
    .optional(),
  downloadToken: z.string().nullable().optional(),
  downloadUrl: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  maxRowsApplied: z.number().optional(),
  filtersApplied: z.record(z.string(), z.unknown()).optional(),
  notifiedAt: z.string().nullable().optional(),
});

export const exportJobProgressResponseSchema = z.object({
  jobId: z.string(),
  historyId: z.number().nullable(),
  profileCode: z.string(),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']),
  totalRows: z.number(),
  processedRows: z.number(),
  remainingRows: z.number(),
  percent: z.number(),
  downloadToken: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
  notifiedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const exportHistoryItemResponseSchema = z.object({
  id: z.number(),
  jobId: z.string().nullable(),
  profileCode: z.string(),
  module: z.string(),
  fileName: z.string(),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  actorId: z.number().nullable(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']),
  filters: z.record(z.string(), z.unknown()),
  totalExported: z.number(),
  processedRows: z.number(),
  maxRowsApplied: z.number(),
  downloadToken: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
  isExpired: z.boolean(),
  notifiedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export const exportTemporaryDownloadResponseSchema = z.object({
  token: z.string(),
  downloadUrl: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  totalExported: z.number(),
  sizeBytes: z.number(),
  createdAt: z.string(),
  expiresAt: z.string(),
  csvContent: z.string().optional(),
  xlsxBase64: z.string().optional(),
  pdfBase64: z.string().optional(),
});
