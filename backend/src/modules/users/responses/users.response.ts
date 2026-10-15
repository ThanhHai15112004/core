import { z } from 'zod';
import type {
  UserOrganizationAssignmentSummary,
  UserRoleAssignmentSummary,
  UserStatus,
} from '../contracts/index.js';

export interface UserResponse {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly phone: string | null;
  readonly fullName: string;
  readonly avatarUrl: string | null;
  readonly status: UserStatus;
  readonly lockedUntil: string | null;
  readonly lockReason: string | null;
  readonly failedLoginAttempts: number;
  readonly mfaEnabled: boolean;
  readonly primaryOrganizationUnitId: string | null;
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

export interface BulkImportUsersResultResponse {
  readonly totalRows: number;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly importedUserIds: readonly string[];
  readonly errors: ReadonlyArray<{
    readonly row: number;
    readonly identifier: string;
    readonly message: string;
  }>;
}

export interface ExportUsersCsvResponse {
  readonly fileName: string;
  readonly contentType: string;
  readonly totalExported: number;
  readonly csvContent: string;
}

export const userRoleSummarySchema = z.object({
  roleId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
});

export const userOrganizationSummarySchema = z.object({
  organizationUnitId: z.string().uuid(),
  code: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  isPrimary: z.boolean(),
  positionTitle: z.string().nullable(),
});

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  fullName: z.string(),
  avatarUrl: z.string().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']),
  lockedUntil: z.string().nullable(),
  lockReason: z.string().nullable(),
  failedLoginAttempts: z.number(),
  mfaEnabled: z.boolean(),
  primaryOrganizationUnitId: z.string().uuid().nullable(),
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

export const bulkImportUsersResultSchema = z.object({
  totalRows: z.number(),
  importedCount: z.number(),
  skippedCount: z.number(),
  failedCount: z.number(),
  importedUserIds: z.array(z.string().uuid()),
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
  totalExported: z.number(),
  csvContent: z.string(),
});
