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
  readonly status: RoleStatusCode;
  readonly statusName: RoleStatusName;
  readonly permissionIds: readonly number[];
  readonly permissions: readonly string[];
}

export interface IRolesPublicService {
  findByIds(roleIds: readonly number[]): Promise<RoleSummary[]>;
  findByCodes(codes: readonly string[]): Promise<RoleSummary[]>;
  resolvePermissionsByRoleIds(roleIds: readonly number[]): Promise<string[]>;
  ensureActiveRolesExist(roleIds: readonly number[]): Promise<RoleSummary[]>;
}

export const ROLES_PUBLIC_SERVICE = Symbol('ROLES_PUBLIC_SERVICE');
