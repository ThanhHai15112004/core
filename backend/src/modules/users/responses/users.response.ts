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

export interface BulkImportUsersResultResponse {
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

export interface ExportUsersCsvResponse {
  readonly fileName: string;
  readonly contentType: string;
  readonly format: 'csv' | 'xlsx';
  readonly totalExported: number;
  readonly csvContent: string;
  readonly xlsxBase64: string;
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

export const bulkImportUsersResultSchema = z.object({
  totalRows: z.number(),
  importedCount: z.number(),
  skippedCount: z.number(),
  failedCount: z.number(),
  importedUserIds: z.array(z.number().int().min(1)),
  errors: z.array(
    z.object({
      row: z.number(),
      identifier: z.string(),
      message: z.string(),
    }),
  ),
});

export const exportUsersCsvResponseSchema = z.object({
  fileName: z.string(),
  contentType: z.string(),
  format: z.enum(['csv', 'xlsx']),
  totalExported: z.number(),
  csvContent: z.string(),
  xlsxBase64: z.string(),
});
