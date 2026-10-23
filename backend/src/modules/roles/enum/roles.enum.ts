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

export const DEFAULT_ALL_SCOPE_ROLE_PATTERNS: readonly string[] = [
  'super_admin',
  'admin',
  'root',
  'auditor',
  'admin_*',
  'super_*',
  'system_*',
  'auditor_*',
] as const;

export const DEFAULT_ALL_SCOPE_PERMISSIONS: readonly string[] = [
  'system.full_access',
  'data_scope.all',
  'roles.manage',
  'system.*',
] as const;

export const ROLES_SETTING_KEYS = {
  ALL_ALLOWED_ROLE_PATTERNS: 'roles.data_scope.all_allowed_role_patterns',
  ALL_ALLOWED_PERMISSIONS: 'roles.data_scope.all_allowed_permissions',
  AUDIT_LOG_PREFIX: 'roles.audit_log',
} as const;

export const ROLES_CODE_TYPES = {
  STATUS: 'roles.status',
  DATA_SCOPE: 'roles.data_scope',
} as const;

export const ROLES_AUDIT_META = {
  MODULE: 'roles',
  FEATURE_ROLE_MANAGEMENT: 'role_management',
  FEATURE_ROLE_PERMISSIONS: 'role_permissions',
  RESOURCE_ROLE: 'role',
  ACTION_CREATED: 'ROLE_CREATED',
  ACTION_CLONED: 'ROLE_CLONED',
  ACTION_UPDATED: 'ROLE_UPDATED',
  ACTION_PERMISSIONS_UPDATED: 'ROLE_PERMISSIONS_UPDATED',
  ACTION_DELETED: 'ROLE_DELETED',
} as const;
