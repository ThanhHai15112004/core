import {
  DATA_SCOPE,
  type DataScopeCode,
  type DataScopeName,
  getDataScopeName,
  inferDefaultDataScopeForRoleCode,
  parseDataScope,
} from '@packages/security/index.js';

export {
  DATA_SCOPE,
  type DataScopeCode,
  type DataScopeName,
  getDataScopeName,
  inferDefaultDataScopeForRoleCode,
  parseDataScope,
};

export const ROLE_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type RoleStatusCode = (typeof ROLE_STATUS)[keyof typeof ROLE_STATUS];
export type RoleStatusName = keyof typeof ROLE_STATUS;

export const PERMISSION_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type PermissionStatusCode = (typeof PERMISSION_STATUS)[keyof typeof PERMISSION_STATUS];
export type PermissionStatusName = keyof typeof PERMISSION_STATUS;

export function parseRoleStatus(val: unknown): RoleStatusCode {
  if (typeof val === 'number' && (val === 1 || val === 2)) return val;
  if (typeof val === 'string') {
    const num = Number(val);
    if (num === 1 || num === 2) return num;
    if (val.trim().toUpperCase() === 'INACTIVE') return ROLE_STATUS.INACTIVE;
  }
  return ROLE_STATUS.ACTIVE;
}

export function getRoleStatusName(code: number): RoleStatusName {
  return code === ROLE_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE';
}

export interface RoleSummary {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly isSystem: boolean;
  readonly dataScope: DataScopeCode;
  readonly dataScopeName: DataScopeName;
  readonly status: RoleStatusCode;
  readonly statusName: RoleStatusName;
  readonly permissionIds: readonly number[];
  readonly permissions: readonly string[];
}

export interface RoleAssignedUserSummary {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: number;
  readonly statusName: string;
  readonly primaryOrganizationUnitId: number | null;
  readonly assignedAt: string;
}

export interface ModulePermissionDeclaration {
  readonly code: string;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly featureGroup?: string | undefined;
}

export interface ModulePermissionsManifestInput {
  readonly module: string;
  readonly displayName?: string | undefined;
  readonly permissions: readonly (string | ModulePermissionDeclaration)[];
}

export interface SyncPermissionsSummary {
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

export interface IRolesPublicService {
  findByIds(roleIds: readonly number[]): Promise<RoleSummary[]>;
  findByCodes(codes: readonly string[]): Promise<RoleSummary[]>;
  resolvePermissionsByRoleIds(roleIds: readonly number[]): Promise<string[]>;
  resolveDataScopesByRoleIds?(roleIds: readonly number[]): Promise<DataScopeCode[]>;
  ensureActiveRolesExist(roleIds: readonly number[]): Promise<RoleSummary[]>;
  registerRoleUserCountDelegate?(
    delegate: (roleIds: readonly number[]) => Promise<Map<number, number>>,
  ): void;
  registerRoleUsersListDelegate?(
    delegate: (roleId: number) => Promise<RoleAssignedUserSummary[]>,
  ): void;
  registerModulePermissions?(input: ModulePermissionsManifestInput): void;
  syncModulePermissions?(
    modules?: readonly ModulePermissionsManifestInput[],
  ): Promise<SyncPermissionsSummary>;
}

export const ROLES_PUBLIC_SERVICE = Symbol('ROLES_PUBLIC_SERVICE');
