import type { UserStatusCode, UserStatusName } from '../enum/users.enum';

export interface UserProfileView {
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly avatarUrl: string | null;
  readonly dateOfBirth: string | null;
  readonly gender: number | null;
  readonly identityNumber: string | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly bio: string | null;
  readonly preferredLocale?: string;
  readonly preferredTimezone?: string;
}

export interface UserRoleAssignmentSummary {
  readonly roleId: number;
  readonly code: string;
  readonly name: string;
  readonly dataScope?: number;
  readonly dataScopeName?: string;
}

export interface UserOrganizationAssignmentSummary {
  readonly organizationUnitId: number;
  readonly code?: string;
  readonly name?: string;
  readonly type?: number;
  readonly typeName?: string;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
}

export interface UserItem {
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

export interface UserOrganizationHistoryItem {
  readonly id: number;
  readonly userId: number;
  readonly organizationUnitId: number;
  readonly organizationUnitCode: string | null;
  readonly organizationUnitName: string | null;
  readonly fromOrganizationUnitId: number | null;
  readonly fromOrganizationUnitCode: string | null;
  readonly fromOrganizationUnitName: string | null;
  readonly actionType: 'ASSIGN' | 'UPDATE' | 'TRANSFER' | 'END';
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly reason: string | null;
  readonly changedBy: number | null;
  readonly createdAt: string;
}

export interface UserSubordinateItem {
  readonly id: number;
  readonly username: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: UserStatusCode;
  readonly statusName: UserStatusName;
  readonly primaryOrganizationUnitId: number | null;
  readonly primaryOrganizationUnitName: string | null;
  readonly positionTitle: string | null;
  readonly managerId: number | null;
  readonly temporaryManagerId: number | null;
  readonly temporaryManagerFrom: string | null;
  readonly temporaryManagerUntil: string | null;
  readonly effectiveManagerId: number | null;
  readonly relationType: 'DIRECT' | 'TEMPORARY' | 'INDIRECT';
  readonly level: number;
}

export interface UserApproverItem {
  readonly step: number;
  readonly userId: number;
  readonly username: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: UserStatusCode;
  readonly primaryOrganizationUnitId: number | null;
  readonly positionTitle: string | null;
  readonly sourceType: 'DIRECT_MANAGER' | 'TEMPORARY_MANAGER';
}

export interface UserSubordinatesOverview {
  readonly userId: number;
  readonly directCount: number;
  readonly temporaryCount: number;
  readonly indirectCount: number;
  readonly totalSubordinates: number;
  readonly subordinates: readonly UserSubordinateItem[];
  readonly approverChain: readonly UserApproverItem[];
}

export interface UserStatusHistoryItem {
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

export interface UserLoginHistoryItem {
  readonly id: number;
  readonly userId: number | null;
  readonly sessionId: number | null;
  readonly identifier: string | null;
  readonly eventType: number;
  readonly eventTypeName: string;
  readonly status: number;
  readonly statusName: 'SUCCESS' | 'FAILED';
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceName: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface UserOrganizationAssignmentInput {
  readonly organizationUnitId: number;
  readonly isPrimary?: boolean;
  readonly positionTitle?: string | null;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
}

export interface CreateUserPayload {
  readonly username?: string;
  readonly email: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly fullName?: string;
  readonly phone?: string | null;
  readonly dateOfBirth?: string | null;
  readonly gender?: number | null;
  readonly identityNumber?: string | null;
  readonly address?: string | null;
  readonly city?: string | null;
  readonly country?: string | null;
  readonly bio?: string | null;
  readonly preferredLocale?: string;
  readonly preferredTimezone?: string;
  readonly password: string;
  readonly status?: UserStatusCode;
  readonly managerId?: number | null;
  readonly temporaryManagerId?: number | null;
  readonly temporaryManagerFrom?: string | null;
  readonly temporaryManagerUntil?: string | null;
  readonly roleIds?: readonly number[];
  readonly organizationUnits?: readonly UserOrganizationAssignmentInput[];
}

export interface UpdateUserPayload {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly fullName?: string;
  readonly email?: string;
  readonly phone?: string | null;
  readonly dateOfBirth?: string | null;
  readonly gender?: number | null;
  readonly identityNumber?: string | null;
  readonly address?: string | null;
  readonly city?: string | null;
  readonly country?: string | null;
  readonly bio?: string | null;
  readonly preferredLocale?: string;
  readonly preferredTimezone?: string;
  readonly managerId?: number | null;
  readonly temporaryManagerId?: number | null;
  readonly temporaryManagerFrom?: string | null;
  readonly temporaryManagerUntil?: string | null;
}

export interface ListUsersFilter {
  readonly q?: string;
  readonly status?: number | '';
  readonly roleId?: number | '';
  readonly organizationUnitId?: number | '';
  readonly includeArchived?: boolean;
  readonly mfaEnabled?: '' | 'true' | 'false';
  readonly page?: number;
  readonly limit?: number;
}

export interface UsersPaginationMeta {
  readonly page: number;
  readonly limit: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface AdminResetPasswordResult {
  readonly reset: true;
  readonly userId: number;
  readonly revokedSessionsCount: number;
  readonly generatedPassword?: string;
}

export interface AdminResetMfaResult {
  readonly reset: true;
  readonly userId: number;
  readonly revokedSessionsCount: number;
  readonly revokedTrustedDevicesCount: number;
  readonly reason: string;
  readonly verificationReference?: string | null;
  readonly resetByActorId?: number | null;
  readonly resetAt: string;
}

export type ImportDuplicateStrategy = 'SKIP' | 'UPDATE' | 'REJECT';

export interface BulkImportUserErrorItem {
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

export interface BulkImportUsersResult {
  readonly totalRows: number;
  readonly importedCount: number;
  readonly updatedCount?: number;
  readonly successCount?: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly remainingCount?: number;
  readonly duplicateStrategy?: ImportDuplicateStrategy;
  readonly historyId?: number;
  readonly jobId?: string | null;
  readonly status?: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  readonly importedUserIds: readonly number[];
  readonly updatedUserIds?: readonly number[];
  readonly errors: ReadonlyArray<BulkImportUserErrorItem>;
}

export interface BulkImportUsersPayload {
  readonly fileName?: string;
  readonly xlsxBase64?: string;
  readonly csvContent?: string;
  readonly columnMapping?: Record<string, string | number | null>;
  readonly defaultPassword?: string;
  readonly skipDuplicates?: boolean;
  readonly duplicateStrategy?: ImportDuplicateStrategy;
  readonly async?: boolean;
  readonly previewLimit?: number;
}

export interface ImportCellIssue {
  readonly row: number;
  readonly sheetRowNumber: number;
  readonly column: string | null;
  readonly columnLetter: string | null;
  readonly field: string | null;
  readonly code: string;
  readonly value?: unknown;
  readonly message: string;
}

export interface ImportColumnMatchItem {
  readonly field: string;
  readonly header: string;
  readonly required: boolean;
  readonly matchedIndex: number;
  readonly matchedHeader: string | null;
  readonly matchedColumnLetter: string | null;
  readonly mappedBy: 'custom' | 'alias' | 'unmapped';
}

export interface ImportPreviewSampleRow {
  readonly row: number;
  readonly sheetRowNumber: number;
  readonly rawValues: Readonly<Record<string, string>>;
  readonly parsedRow: Readonly<Record<string, unknown>> | null;
  readonly status: 'VALID' | 'DUPLICATE_SKIP' | 'DUPLICATE_UPDATE' | 'DUPLICATE_REJECT' | 'INVALID';
  readonly existingRecordId: number | string | null;
  readonly issues: ReadonlyArray<ImportCellIssue>;
}

export interface ImportUsersPreviewResponse {
  readonly profileCode: string;
  readonly detectedHeaders: readonly string[];
  readonly headerRowIndex: number;
  readonly columnMatches: ReadonlyArray<ImportColumnMatchItem>;
  readonly unmappedRequiredFields: readonly string[];
  readonly totalRows: number;
  readonly validRowsCount: number;
  readonly invalidRowsCount: number;
  readonly duplicateRowsCount: number;
  readonly willCreateCount: number;
  readonly willUpdateCount: number;
  readonly willSkipCount: number;
  readonly willRejectCount: number;
  readonly duplicateStrategy: ImportDuplicateStrategy;
  readonly sampleRows: ReadonlyArray<ImportPreviewSampleRow>;
  readonly issues: ReadonlyArray<ImportCellIssue>;
}

export interface ImportJobProgress {
  readonly jobId: string;
  readonly profileCode: string;
  readonly status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  readonly totalRows: number;
  readonly processedRows: number;
  readonly remainingRows: number;
  readonly successCount: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly percent: number;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface ImportHistoryItem {
  readonly id: number;
  readonly jobId: string | null;
  readonly profileCode: string;
  readonly module: string;
  readonly fileName: string;
  readonly format: 'csv' | 'xlsx' | 'json';
  readonly duplicateStrategy: ImportDuplicateStrategy;
  readonly actorId: number | null;
  readonly status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  readonly totalRows: number;
  readonly processedRows: number;
  readonly remainingRows: number;
  readonly successCount: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly errors: ReadonlyArray<ImportCellIssue>;
  readonly columnMapping: Readonly<Record<string, string | number | null>> | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface ExportUsersFileResponse {
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

export interface ExportJobProgress {
  readonly jobId: string;
  readonly historyId: number | null;
  readonly profileCode: string;
  readonly format: 'csv' | 'xlsx' | 'pdf';
  readonly status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  readonly totalRows: number;
  readonly processedRows: number;
  readonly remainingRows: number;
  readonly percent: number;
  readonly downloadToken: string | null;
  readonly downloadUrl: string | null;
  readonly expiresAt: string | null;
  readonly notifiedAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface ExportHistoryItem {
  readonly id: number;
  readonly jobId: string | null;
  readonly profileCode: string;
  readonly module: string;
  readonly fileName: string;
  readonly format: 'csv' | 'xlsx' | 'pdf';
  readonly actorId: number | null;
  readonly status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  readonly filters: Readonly<Record<string, unknown>>;
  readonly totalExported: number;
  readonly processedRows: number;
  readonly maxRowsApplied: number;
  readonly downloadToken: string | null;
  readonly downloadUrl: string | null;
  readonly expiresAt: string | null;
  readonly isExpired: boolean;
  readonly notifiedAt: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface TemporaryDownloadFileResponse {
  readonly token: string;
  readonly downloadUrl: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly format: 'csv' | 'xlsx' | 'pdf';
  readonly totalExported: number;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly csvContent?: string;
  readonly xlsxBase64?: string;
  readonly pdfBase64?: string;
}

export interface RegisteredReportParameterDef {
  readonly key: string;
  readonly name: string;
  readonly type:
    | 'date-range'
    | 'status'
    | 'organization-unit'
    | 'filter'
    | 'string'
    | 'number'
    | 'boolean';
  readonly required?: boolean;
  readonly defaultValue?: unknown;
  readonly allowedValues?: ReadonlyArray<string | number | boolean>;
}

export interface RegisteredReportDefinition {
  readonly code: string;
  readonly module: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: 'REPORT' | 'DASHBOARD';
  readonly requiredPermission: string;
  readonly isHeavy: boolean;
  readonly heavyRecordThreshold: number;
  readonly cacheTtlSeconds: number;
  readonly supportsReadReplica: boolean;
  readonly supportedFormats: ReadonlyArray<'xlsx' | 'csv' | 'pdf'>;
  readonly parameters: ReadonlyArray<RegisteredReportParameterDef>;
  readonly isSystem: boolean;
  readonly status: number;
}

export interface RunUserReportPayload {
  readonly reportCode: string;
  readonly fromDate?: string | null;
  readonly toDate?: string | null;
  readonly status?: number | string | null;
  readonly organizationUnitId?: number | null;
  readonly includeSubUnits?: boolean;
  readonly format?: 'csv' | 'xlsx' | 'pdf';
  readonly async?: boolean;
  readonly useCache?: boolean;
  readonly forceRefresh?: boolean;
  readonly preferReplica?: boolean;
  readonly ttlSeconds?: number;
  readonly notifyChannels?: ReadonlyArray<'EMAIL' | 'IN_APP'>;
  readonly recipientEmails?: ReadonlyArray<string>;
}

export interface UserReportExecutionResult {
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
    readonly statuses: ReadonlyArray<string | number>;
    readonly organizationUnitId: number | null;
    readonly includeSubUnits: boolean;
    readonly filters: Readonly<Record<string, unknown>>;
  };
  readonly totalRecords: number;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly format?: 'csv' | 'xlsx' | 'pdf' | null;
  readonly fileName?: string | null;
  readonly downloadToken?: string | null;
  readonly downloadUrl?: string | null;
  readonly expiresAt?: string | null;
  readonly notifiedChannels: ReadonlyArray<'EMAIL' | 'IN_APP'>;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

export interface CreateUserReportSchedulePayload {
  readonly reportCode: string;
  readonly name: string;
  readonly frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  readonly hour?: number;
  readonly minute?: number;
  readonly dayOfWeek?: number;
  readonly dayOfMonth?: number;
  readonly timezone?: string;
  readonly format?: 'csv' | 'xlsx' | 'pdf';
  readonly parameters?: {
    readonly fromDate?: string | null;
    readonly toDate?: string | null;
    readonly status?: number | string | null;
    readonly organizationUnitId?: number | null;
    readonly includeSubUnits?: boolean;
  };
  readonly channels?: ReadonlyArray<'EMAIL' | 'IN_APP'>;
  readonly recipientEmails?: ReadonlyArray<string>;
  readonly ttlSeconds?: number;
  readonly isActive?: boolean;
}

export interface UserReportScheduleItem {
  readonly id: number;
  readonly reportCode: string;
  readonly module: string;
  readonly name: string;
  readonly frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  readonly cronExpression: string;
  readonly hour: number;
  readonly minute: number;
  readonly dayOfWeek: number | null;
  readonly dayOfMonth: number | null;
  readonly timezone: string;
  readonly format: 'xlsx' | 'csv' | 'pdf';
  readonly channels: ReadonlyArray<'EMAIL' | 'IN_APP'>;
  readonly recipientEmails: ReadonlyArray<string>;
  readonly recipientUserIds: ReadonlyArray<number>;
  readonly ttlSeconds: number;
  readonly actorId: number | null;
  readonly isActive: boolean;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserReportHistoryItem {
  readonly id: number;
  readonly jobId: string | null;
  readonly scheduleId: number | null;
  readonly reportCode: string;
  readonly module: string;
  readonly reportName: string;
  readonly actorId: number | null;
  readonly executionMode: 'SYNC' | 'QUEUE' | 'SCHEDULED';
  readonly dataSourceUsed: 'REPLICA' | 'PRIMARY' | 'CACHE';
  readonly cacheHit: boolean;
  readonly status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  readonly format: 'xlsx' | 'csv' | 'pdf' | null;
  readonly fileName: string | null;
  readonly totalRecords: number;
  readonly summary: Readonly<Record<string, unknown>> | null;
  readonly downloadToken: string | null;
  readonly downloadUrl: string | null;
  readonly expiresAt: string | null;
  readonly isExpired: boolean;
  readonly notifiedChannels: ReadonlyArray<'EMAIL' | 'IN_APP'>;
  readonly recipientEmails: ReadonlyArray<string>;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

export interface TriggeredReportScheduleResult {
  readonly triggeredCount: number;
  readonly items: ReadonlyArray<{
    readonly scheduleId: number;
    readonly reportCode: string;
    readonly historyId: number;
    readonly status: string;
    readonly downloadUrl: string | null;
    readonly nextRunAt: string;
  }>;
}

export interface RegisteredSearchableEntity {
  readonly code: string;
  readonly module: string;
  readonly entityType: string;
  readonly name: string;
  readonly description: string | null;
  readonly requiredPermission: string;
  readonly searchableFields: ReadonlyArray<string>;
  readonly titleField: string;
  readonly subtitleField: string | null;
  readonly staleThresholdMs: number;
  readonly isSystem: boolean;
  readonly status: number;
  readonly registeredAt: string;
}

export interface SearchHitItem {
  readonly documentKey: string;
  readonly id: string | number;
  readonly entityCode: string;
  readonly module: string;
  readonly entityType: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly score: number;
  readonly matchedHighlights: ReadonlyArray<string>;
  readonly ownerId: number | null;
  readonly organizationUnitId: number | null;
  readonly status: number | string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sourceUpdatedAt: string;
  readonly indexedAt: string;
  readonly indexLagMs: number;
  readonly isStale: boolean;
}

export interface SearchQueryResult {
  readonly keyword: string;
  readonly normalizedKeyword: string;
  readonly driverUsed: 'DATABASE' | 'ELASTICSEARCH' | 'OPENSEARCH';
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly staleHitCount: number;
  readonly maxIndexLagMs: number;
  readonly hits: ReadonlyArray<SearchHitItem>;
}

export interface SearchSyncHistoryItem {
  readonly id: number;
  readonly operation: 'SYNC' | 'REBUILD' | 'REMOVE';
  readonly module: string | null;
  readonly entityType: string | null;
  readonly entityCode: string | null;
  readonly driverUsed: 'DATABASE' | 'ELASTICSEARCH' | 'OPENSEARCH';
  readonly executionMode: 'SYNC' | 'QUEUE';
  readonly status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  readonly indexedCount: number;
  readonly removedCount: number;
  readonly jobId: string | null;
  readonly actorId: number | null;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface SearchIndexLagReport {
  readonly driverUsed: 'DATABASE' | 'ELASTICSEARCH' | 'OPENSEARCH';
  readonly totalIndexedDocuments: number;
  readonly staleDocumentCount: number;
  readonly maxLagMs: number;
  readonly averageLagMs: number;
  readonly items: ReadonlyArray<{
    readonly documentKey: string;
    readonly id: string | number;
    readonly entityCode: string;
    readonly module: string;
    readonly entityType: string;
    readonly title: string;
    readonly sourceUpdatedAt: string;
    readonly indexedAt: string;
    readonly lagMs: number;
    readonly staleThresholdMs: number;
    readonly isStale: boolean;
  }>;
}

export interface ZeroResultKeywordStat {
  readonly normalizedKeyword: string;
  readonly sampleKeyword: string;
  readonly searchCount: number;
  readonly lastSearchedAt: string;
  readonly modules: ReadonlyArray<string>;
  readonly entityTypes: ReadonlyArray<string>;
  readonly lastActorId: number | null;
}

export interface RoleOptionSummary {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly dataScopeName?: string;
}

export interface OrganizationOptionSummary {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly typeName?: string;
}

