export type RoleStatus = 'ACTIVE' | 'INACTIVE';

export interface RoleSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: RoleStatus;
  readonly isSystem: boolean;
  readonly permissions: readonly string[];
}

export interface IRolesPublicService {
  findByIds(roleIds: readonly string[]): Promise<RoleSummary[]>;
  findByCodes(codes: readonly string[]): Promise<RoleSummary[]>;
  resolvePermissionsByRoleIds(roleIds: readonly string[]): Promise<string[]>;
  ensureActiveRolesExist(roleIds: readonly string[]): Promise<RoleSummary[]>;
}

export const ROLES_PUBLIC_SERVICE = Symbol('ROLES_PUBLIC_SERVICE');
