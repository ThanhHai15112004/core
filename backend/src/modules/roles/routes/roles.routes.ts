export const ROLES_ROUTES = {
  PREFIX: 'roles',
  ROOT: '',
  PERMISSIONS_CATALOG: 'permissions',
  PERMISSIONS_GROUPED: 'permissions/grouped',
  PERMISSIONS_SYNC: 'permissions/sync',
  PERMISSIONS_ORPHANS: 'permissions/orphans',
  PERMISSIONS_MATRIX: 'permissions/matrix',
  BY_ID: ':id',
  ROLE_PERMISSIONS: ':id/permissions',
  CLONE: ':id/clone',
  ROLE_USERS: ':id/users',
  buildByIdPath: (id: string) => `/roles/${id}`,
} as const;
