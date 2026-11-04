export const ROLES_ROUTES = {
  PREFIX: 'roles',
  ROOT: '',
  MATRIX: 'matrix',
  DATA_SCOPES_ME: 'data-scopes/me',
  DATA_SCOPES_RULES: 'data-scopes/rules',
  USER_ROLES: 'users/:userId',
  BY_ID: ':id',
  ROLE_PERMISSIONS: ':id/permissions',
  CLONE: ':id/clone',
  ROLE_USERS: ':id/users',
  buildByIdPath: (id: string) => `/roles/${id}`,
} as const;
