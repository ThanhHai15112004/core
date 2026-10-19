export const ROLES_ROUTES = {
  PREFIX: 'roles',
  ROOT: '',
  PERMISSIONS_CATALOG: 'permissions',
  BY_ID: ':id',
  ROLE_PERMISSIONS: ':id/permissions',
  CLONE: ':id/clone',
  ROLE_USERS: ':id/users',
  buildByIdPath: (id: string) => `/roles/${id}`,
} as const;
