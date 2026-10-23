export const ROUTES = {
  HOME: '/',
  AUTH: '/auth',
  ORGANIZATIONS: '/organizations',
  ROLES: '/roles',
  USERS: '/users',
  CODES: '/codes',
  SETTINGS: '/settings',
  FILES: '/files',
  NOTIFICATIONS: '/notifications',
  SYSTEM_CONSOLE: '/system-console',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
