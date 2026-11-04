import { defaultCodeRegistry } from '@packages/kernel/index.js';
import {
  DATA_SCOPE,
  type DataScopeCode,
  type DataScopeName,
  type UserIdentity,
  getDataScopeName,
  inferDefaultDataScopeForRoleCode,
  parseDataScope,
} from '@packages/security/index.js';
import type {
  ModulePermissionDeclaration,
  ModulePermissionsManifestInput,
  SyncPermissionsSummary,
} from '@modules/permissions/index.js';
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
  type ModulePermissionDeclaration,
  type ModulePermissionsManifestInput,
  type SyncPermissionsSummary,
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

export interface UserRoleLinkSummary {
  readonly id?: number | undefined;
  readonly userId: number;
  readonly roleId: number;
  readonly assignedBy?: number | null | undefined;
  readonly createdAt?: Date | undefined;
}

export interface AssignUserRolesContractInput {
  readonly roleIds: readonly number[];
  readonly stepUpToken?: string | undefined;
  readonly requireStepUp?: boolean | undefined;
}

export interface IRolesPublicService {
  findByIds(roleIds: readonly number[]): Promise<RoleSummary[]>;
  findByCodes(codes: readonly string[]): Promise<RoleSummary[]>;
  resolvePermissionsByRoleIds(roleIds: readonly number[]): Promise<string[]>;
  resolveDataScopesByRoleIds?(roleIds: readonly number[]): Promise<DataScopeCode[]>;
  ensureActiveRolesExist(roleIds: readonly number[]): Promise<RoleSummary[]>;
  findUserRoleLinksByUserIds?(userIds: readonly number[]): Promise<UserRoleLinkSummary[]>;
  findUserRoleLinksByRoleIds?(roleIds: readonly number[]): Promise<UserRoleLinkSummary[]>;
  findUserIdsByRoleIds?(roleIds: readonly number[]): Promise<number[]>;
  replaceUserRoles?(
    userId: number,
    roleIds: readonly number[],
    assignedBy?: number | null,
  ): Promise<UserRoleLinkSummary[]>;
  assignUserRoles?<T = unknown>(
    userId: number,
    dto: AssignUserRolesContractInput,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<T>;
  registerRoleUserCountDelegate?(
    delegate: (roleIds: readonly number[]) => Promise<Map<number, number>>,
  ): void;
  registerRoleUsersListDelegate?(
    delegate: (roleId: number) => Promise<RoleAssignedUserSummary[]>,
  ): void;
  registerUserRoleAssignmentDelegate?(
    delegate: (
      userId: number,
      dto: AssignUserRolesContractInput,
      actorId?: number,
      actor?: UserIdentity,
    ) => Promise<unknown>,
  ): void;
  registerModulePermissions?(input: ModulePermissionsManifestInput): void;
  syncModulePermissions?(
    modules?: readonly ModulePermissionsManifestInput[],
  ): Promise<SyncPermissionsSummary>;
}

export const ROLES_PUBLIC_SERVICE = Symbol('ROLES_PUBLIC_SERVICE');
