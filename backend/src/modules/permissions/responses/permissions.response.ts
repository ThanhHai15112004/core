import { z } from 'zod';
import type { DataScopeCode, DataScopeName } from '@packages/security/index.js';
import type { PermissionStatusCode, PermissionStatusName } from '../contracts/index.js';

export interface PermissionCatalogItemResponse {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly featureGroup: string;
  readonly description: string | null;
  readonly status: PermissionStatusCode;
  readonly statusName: PermissionStatusName;
  readonly isOrphaned: boolean;
}

export const permissionCatalogItemResponseSchema = z.object({
  id: z.number().int().min(1),
  code: z.string(),
  name: z.string(),
  module: z.string(),
  featureGroup: z.string(),
  description: z.string().nullable(),
  status: z.number().int().min(1).max(2),
  statusName: z.enum(['ACTIVE', 'INACTIVE']),
  isOrphaned: z.boolean(),
});

export interface PermissionFunctionalGroupResponse {
  readonly module: string;
  readonly moduleDisplayName: string;
  readonly featureGroup: string;
  readonly totalPermissions: number;
  readonly permissions: readonly PermissionCatalogItemResponse[];
}

export const permissionFunctionalGroupResponseSchema = z.object({
  module: z.string(),
  moduleDisplayName: z.string(),
  featureGroup: z.string(),
  totalPermissions: z.number().int().min(0),
  permissions: z.array(permissionCatalogItemResponseSchema),
});

export interface SyncPermissionsResultResponse {
  readonly totalDeclared: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly orphanedCount: number;
  readonly createdCodes: readonly string[];
  readonly updatedCodes: readonly string[];
  readonly orphanedCodes: readonly string[];
  readonly syncedModules: readonly string[];
}

export const syncPermissionsResultResponseSchema = z.object({
  totalDeclared: z.number().int().min(0),
  createdCount: z.number().int().min(0),
  updatedCount: z.number().int().min(0),
  unchangedCount: z.number().int().min(0),
  orphanedCount: z.number().int().min(0),
  createdCodes: z.array(z.string()),
  updatedCodes: z.array(z.string()),
  orphanedCodes: z.array(z.string()),
  syncedModules: z.array(z.string()),
});

export interface OrphanedPermissionWarningResponse {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly assignedRoles: readonly {
    readonly id: number;
    readonly code: string;
    readonly name: string;
  }[];
  readonly warningMessage: string;
}

export const orphanedPermissionWarningResponseSchema = z.object({
  id: z.number().int().min(1),
  code: z.string(),
  name: z.string(),
  module: z.string(),
  assignedRoles: z.array(
    z.object({
      id: z.number().int().min(1),
      code: z.string(),
      name: z.string(),
    }),
  ),
  warningMessage: z.string(),
});

export interface RolePermissionMatrixRowResponse {
  readonly permissionId: number;
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly featureGroup: string;
  readonly isOrphaned: boolean;
  readonly grantedRoleIds: readonly number[];
  readonly grantedRoleCodes: readonly string[];
  readonly roleGrants: Readonly<Record<string, boolean>>;
}

export interface RolePermissionMatrixResponse {
  readonly roles: readonly {
    readonly id: number;
    readonly code: string;
    readonly name: string;
    readonly isSystem: boolean;
    readonly dataScope: DataScopeCode;
    readonly dataScopeName: DataScopeName;
    readonly status: 1 | 2;
    readonly statusName: 'ACTIVE' | 'INACTIVE';
    readonly totalGrantedPermissions: number;
  }[];
  readonly modules: readonly string[];
  readonly rows: readonly RolePermissionMatrixRowResponse[];
  readonly summary: {
    readonly totalRoles: number;
    readonly totalPermissions: number;
    readonly totalOrphanedPermissions: number;
  };
}

export const rolePermissionMatrixResponseSchema = z.object({
  roles: z.array(
    z.object({
      id: z.number().int().min(1),
      code: z.string(),
      name: z.string(),
      isSystem: z.boolean(),
      dataScope: z.number().int().min(1).max(4),
      dataScopeName: z.enum(['ALL', 'ORG_UNIT', 'SUBORDINATES', 'SELF']),
      status: z.number().int().min(1).max(2),
      statusName: z.enum(['ACTIVE', 'INACTIVE']),
      totalGrantedPermissions: z.number().int().min(0),
    }),
  ),
  modules: z.array(z.string()),
  rows: z.array(
    z.object({
      permissionId: z.number().int().min(1),
      code: z.string(),
      name: z.string(),
      module: z.string(),
      featureGroup: z.string(),
      isOrphaned: z.boolean(),
      grantedRoleIds: z.array(z.number().int().min(1)),
      grantedRoleCodes: z.array(z.string()),
      roleGrants: z.record(z.string(), z.boolean()),
    }),
  ),
  summary: z.object({
    totalRoles: z.number().int().min(0),
    totalPermissions: z.number().int().min(0),
    totalOrphanedPermissions: z.number().int().min(0),
  }),
});
