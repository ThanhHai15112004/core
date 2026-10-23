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

export interface BulkImportUsersResult {
  readonly totalRows: number;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly importedUserIds: readonly number[];
  readonly errors: ReadonlyArray<{
    readonly row: number;
    readonly identifier: string;
    readonly message: string;
  }>;
}

export interface ExportUsersFileResponse {
  readonly fileName: string;
  readonly contentType: string;
  readonly format: 'csv' | 'xlsx';
  readonly totalExported: number;
  readonly csvContent: string;
  readonly xlsxBase64: string;
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

