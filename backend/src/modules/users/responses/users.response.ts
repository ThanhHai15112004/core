import { z } from 'zod';
import type {
  UserApproverSummaryView,
  UserOrganizationAssignmentSummary,
  UserOrganizationHistoryActionType,
  UserOrganizationHistoryItemView,
  UserProfileView,
  UserRoleAssignmentSummary,
  UserStatusCode,
  UserStatusName,
  UserSubordinateSummaryView,
} from '../contracts/index.js';

export type {
  UserApproverSummaryView,
  UserOrganizationHistoryItemView,
  UserSubordinateSummaryView,
};

export type UserOrganizationHistoryItemResponse = UserOrganizationHistoryItemView;

export interface UserSubordinatesOverviewResponse {
  readonly userId: number;
  readonly managerId: number;
  readonly directCount: number;
  readonly temporaryCount: number;
  readonly indirectCount: number;
  readonly totalSubordinates: number;
  readonly subordinates: readonly UserSubordinateSummaryView[];
  readonly approverChain: readonly UserApproverSummaryView[];
}

export interface UserResponse {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly employeeCode?: string | null;
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
  readonly temporaryManagerId?: number | null;
  readonly temporaryManagerFrom?: string | null;
  readonly temporaryManagerUntil?: string | null;
  readonly effectiveManagerId?: number | null;
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
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
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
  temporaryManagerId: z.number().int().min(1).nullable().optional(),
  temporaryManagerFrom: z.string().nullable().optional(),
  temporaryManagerUntil: z.string().nullable().optional(),
  effectiveManagerId: z.number().int().min(1).nullable().optional(),
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

export const userOrganizationHistoryItemSchema = z.object({
  id: z.number().int().min(1),
  userId: z.number().int().min(1),
  organizationUnitId: z.number().int().min(1),
  organizationUnitCode: z.string().nullable().optional(),
  organizationUnitName: z.string().nullable().optional(),
  fromOrganizationUnitId: z.number().int().min(1).nullable(),
  fromOrganizationUnitCode: z.string().nullable().optional(),
  fromOrganizationUnitName: z.string().nullable().optional(),
  actionType: z.enum([
    'ASSIGN',
    'TRANSFER',
    'UPDATE',
    'END',
  ] satisfies readonly UserOrganizationHistoryActionType[]),
  isPrimary: z.boolean(),
  positionTitle: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  reason: z.string().nullable(),
  changedBy: z.number().int().min(1).nullable(),
  createdAt: z.string(),
});

export const userSubordinateSummarySchema = z.object({
  id: z.number().int().min(1),
  username: z.string(),
  fullName: z.string(),
  email: z.string(),
  status: z.number().int().min(1).max(4),
  statusName: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED', 'ARCHIVED']),
  primaryOrganizationUnitId: z.number().int().min(1).nullable(),
  primaryOrganizationUnitName: z.string().nullable().optional(),
  positionTitle: z.string().nullable(),
  managerId: z.number().int().min(1).nullable(),
  temporaryManagerId: z.number().int().min(1).nullable(),
  temporaryManagerFrom: z.string().nullable(),
  temporaryManagerUntil: z.string().nullable(),
  effectiveManagerId: z.number().int().min(1).nullable(),
  relationType: z.enum(['DIRECT', 'TEMPORARY', 'INDIRECT']),
  level: z.number().int().min(1),
});

export const userApproverSummarySchema = z.object({
  step: z.number().int().min(1),
  userId: z.number().int().min(1),
  username: z.string(),
  fullName: z.string(),
  email: z.string(),
  status: z.number().int().min(1).max(4),
  primaryOrganizationUnitId: z.number().int().min(1).nullable(),
  positionTitle: z.string().nullable(),
  sourceType: z.enum(['DIRECT_MANAGER', 'TEMPORARY_MANAGER']),
});

export const userSubordinatesOverviewResponseSchema = z.object({
  userId: z.number().int().min(1),
  managerId: z.number().int().min(1),
  directCount: z.number().int().min(0),
  temporaryCount: z.number().int().min(0),
  indirectCount: z.number().int().min(0),
  totalSubordinates: z.number().int().min(0),
  subordinates: z.array(userSubordinateSummarySchema),
  approverChain: z.array(userApproverSummarySchema),
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

export interface UserReportExecutionResponse {
  readonly reportCode: string;
  readonly reportName: string;
  readonly module: string;
  readonly category: 'REPORT' | 'DASHBOARD';
  readonly requiredPermission: string;
  readonly historyId: number;
  readonly jobId: string | null;
  readonly status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  readonly executionMode: 'SYNC' | 'QUEUE' | 'SCHEDULED';
  readonly dataSourceUsed: 'REPLICA' | 'PRIMARY' | 'CACHE';
  readonly cacheHit: boolean;
  readonly cacheKey: string | null;
  readonly parameters: {
    readonly fromDate: string | null;
    readonly toDate: string | null;
    readonly statuses: readonly (string | number)[];
    readonly organizationUnitId: number | null;
    readonly includeSubUnits: boolean;
    readonly filters: Readonly<Record<string, unknown>>;
  };
  readonly totalRecords: number;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly format?: 'csv' | 'xlsx' | 'pdf' | null | undefined;
  readonly fileName?: string | null | undefined;
  readonly downloadToken?: string | null | undefined;
  readonly downloadUrl?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly notifiedChannels: readonly ('EMAIL' | 'IN_APP')[];
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

export const registeredReportDefinitionResponseSchema = z.object({
  code: z.string(),
  module: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.enum(['REPORT', 'DASHBOARD']),
  requiredPermission: z.string(),
  isHeavy: z.boolean(),
  heavyRecordThreshold: z.number(),
  cacheTtlSeconds: z.number(),
  supportsReadReplica: z.boolean(),
  supportedFormats: z.array(z.enum(['xlsx', 'csv', 'pdf'])),
  parameters: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      type: z.enum([
        'date-range',
        'status',
        'organization-unit',
        'filter',
        'string',
        'number',
        'boolean',
      ]),
      required: z.boolean().optional(),
      defaultValue: z.unknown().optional(),
      allowedValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
  ),
  isSystem: z.boolean(),
  status: z.number(),
});

export const userReportExecutionResponseSchema = z.object({
  reportCode: z.string(),
  reportName: z.string(),
  module: z.string(),
  category: z.enum(['REPORT', 'DASHBOARD']),
  requiredPermission: z.string(),
  historyId: z.number(),
  jobId: z.string().nullable(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']),
  executionMode: z.enum(['SYNC', 'QUEUE', 'SCHEDULED']),
  dataSourceUsed: z.enum(['REPLICA', 'PRIMARY', 'CACHE']),
  cacheHit: z.boolean(),
  cacheKey: z.string().nullable(),
  parameters: z.object({
    fromDate: z.string().nullable(),
    toDate: z.string().nullable(),
    statuses: z.array(z.union([z.string(), z.number()])),
    organizationUnitId: z.number().nullable(),
    includeSubUnits: z.boolean(),
    filters: z.record(z.string(), z.unknown()),
  }),
  totalRecords: z.number(),
  summary: z.record(z.string(), z.unknown()),
  rows: z.array(z.record(z.string(), z.unknown())),
  format: z.enum(['csv', 'xlsx', 'pdf']).nullable().optional(),
  fileName: z.string().nullable().optional(),
  downloadToken: z.string().nullable().optional(),
  downloadUrl: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  notifiedChannels: z.array(z.enum(['EMAIL', 'IN_APP'])),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
});

export const userReportScheduleItemResponseSchema = z.object({
  id: z.number(),
  reportCode: z.string(),
  module: z.string(),
  name: z.string(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  cronExpression: z.string(),
  hour: z.number(),
  minute: z.number(),
  dayOfWeek: z.number().nullable(),
  dayOfMonth: z.number().nullable(),
  timezone: z.string(),
  format: z.enum(['xlsx', 'csv', 'pdf']),
  parameters: z.object({
    fromDate: z.string().nullable(),
    toDate: z.string().nullable(),
    statuses: z.array(z.union([z.string(), z.number()])),
    organizationUnitId: z.number().nullable(),
    includeSubUnits: z.boolean(),
    filters: z.record(z.string(), z.unknown()),
  }),
  channels: z.array(z.enum(['EMAIL', 'IN_APP'])),
  recipientEmails: z.array(z.string()),
  recipientUserIds: z.array(z.number()),
  ttlSeconds: z.number(),
  actorId: z.number().nullable(),
  isActive: z.boolean(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const userReportHistoryItemResponseSchema = z.object({
  id: z.number(),
  jobId: z.string().nullable(),
  scheduleId: z.number().nullable(),
  reportCode: z.string(),
  module: z.string(),
  reportName: z.string(),
  actorId: z.number().nullable(),
  parameters: z.object({
    fromDate: z.string().nullable(),
    toDate: z.string().nullable(),
    statuses: z.array(z.union([z.string(), z.number()])),
    organizationUnitId: z.number().nullable(),
    includeSubUnits: z.boolean(),
    filters: z.record(z.string(), z.unknown()),
  }),
  executionMode: z.enum(['SYNC', 'QUEUE', 'SCHEDULED']),
  dataSourceUsed: z.enum(['REPLICA', 'PRIMARY', 'CACHE']),
  cacheHit: z.boolean(),
  cacheKey: z.string().nullable(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']),
  format: z.enum(['xlsx', 'csv', 'pdf']).nullable(),
  fileName: z.string().nullable(),
  totalRecords: z.number(),
  summary: z.record(z.string(), z.unknown()).nullable(),
  downloadToken: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
  isExpired: z.boolean(),
  notifiedChannels: z.array(z.enum(['EMAIL', 'IN_APP'])),
  recipientEmails: z.array(z.string()),
  recipientUserIds: z.array(z.number()),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
});

export const registeredSearchableEntityResponseSchema = z.object({
  code: z.string(),
  module: z.string(),
  entityType: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  requiredPermission: z.string(),
  searchableFields: z.array(z.string()),
  titleField: z.string(),
  subtitleField: z.string().nullable(),
  staleThresholdMs: z.number(),
  isSystem: z.boolean(),
  status: z.number(),
  registeredAt: z.string(),
});

export const searchHitItemResponseSchema = z.object({
  documentKey: z.string(),
  id: z.union([z.string(), z.number()]),
  entityCode: z.string(),
  module: z.string(),
  entityType: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  score: z.number(),
  matchedHighlights: z.array(z.string()),
  ownerId: z.number().nullable(),
  organizationUnitId: z.number().nullable(),
  status: z.union([z.number(), z.string()]).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  sourceUpdatedAt: z.string(),
  indexedAt: z.string(),
  indexLagMs: z.number(),
  isStale: z.boolean(),
});

export const searchQueryResultResponseSchema = z.object({
  keyword: z.string(),
  normalizedKeyword: z.string(),
  driverUsed: z.enum(['DATABASE', 'ELASTICSEARCH', 'OPENSEARCH']),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  staleHitCount: z.number(),
  maxIndexLagMs: z.number(),
  hits: z.array(searchHitItemResponseSchema),
});

export const searchSyncHistoryResponseSchema = z.object({
  id: z.number(),
  operation: z.enum(['SYNC', 'REBUILD', 'REMOVE']),
  module: z.string().nullable(),
  entityType: z.string().nullable(),
  entityCode: z.string().nullable(),
  driverUsed: z.enum(['DATABASE', 'ELASTICSEARCH', 'OPENSEARCH']),
  executionMode: z.enum(['SYNC', 'QUEUE']),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']),
  indexedCount: z.number(),
  removedCount: z.number(),
  jobId: z.string().nullable(),
  actorId: z.number().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const searchIndexLagReportResponseSchema = z.object({
  driverUsed: z.enum(['DATABASE', 'ELASTICSEARCH', 'OPENSEARCH']),
  totalIndexedDocuments: z.number(),
  staleDocumentCount: z.number(),
  maxLagMs: z.number(),
  averageLagMs: z.number(),
  items: z.array(
    z.object({
      documentKey: z.string(),
      id: z.union([z.string(), z.number()]),
      entityCode: z.string(),
      module: z.string(),
      entityType: z.string(),
      title: z.string(),
      sourceUpdatedAt: z.string(),
      indexedAt: z.string(),
      lagMs: z.number(),
      staleThresholdMs: z.number(),
      isStale: z.boolean(),
    }),
  ),
});

export const zeroResultKeywordStatResponseSchema = z.object({
  normalizedKeyword: z.string(),
  sampleKeyword: z.string(),
  searchCount: z.number(),
  lastSearchedAt: z.string(),
  modules: z.array(z.string()),
  entityTypes: z.array(z.string()),
  lastActorId: z.number().nullable(),
});
