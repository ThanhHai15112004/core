export const ROUTES = {
  HOME: '/',
  AUTH: '/auth',
  ORGANIZATIONS: '/organizations',
  ROLES: '/roles',
  USERS: '/users',
  FILES: '/files',
  SYSTEM_CONSOLE: '/system-console',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
