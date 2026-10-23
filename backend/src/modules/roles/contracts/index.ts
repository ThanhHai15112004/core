import { defaultCodeRegistry } from '@packages/kernel/index.js';
import {
  DATA_SCOPE,
  type DataScopeCode,
  type DataScopeName,
  getDataScopeName,
  inferDefaultDataScopeForRoleCode,
  parseDataScope,
} from '@packages/security/index.js';
import {
  PERMISSION_STATUS,
  type PermissionStatusCode,
  type PermissionStatusName,
  ROLES_CODE_TYPES,
  ROLE_STATUS,
  type RoleStatusCode,
  type RoleStatusName,
} from '../enum/roles.enum.js';

export {
  DATA_SCOPE,
  type DataScopeCode,
  type DataScopeName,
  getDataScopeName,
  inferDefaultDataScopeForRoleCode,
  parseDataScope,
  PERMISSION_STATUS,
  type PermissionStatusCode,
  type PermissionStatusName,
  ROLE_STATUS,
  type RoleStatusCode,
  type RoleStatusName,
};

export function parseRoleStatus(val: unknown): RoleStatusCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    ROLES_CODE_TYPES.STATUS,
    val,
    ROLE_STATUS.ACTIVE,
  );
  return resolved === ROLE_STATUS.INACTIVE ? ROLE_STATUS.INACTIVE : ROLE_STATUS.ACTIVE;
}

export function getRoleStatusName(code: number): RoleStatusName {
  const name = defaultCodeRegistry.getCodeName(ROLES_CODE_TYPES.STATUS, code, 'ACTIVE');
  return name === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
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
