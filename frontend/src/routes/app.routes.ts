export const ROUTES = {
  HOME: '/',
  AUTH: '/auth',
  ORGANIZATIONS: '/organizations',
  FILES: '/files',
  SYSTEM_CONSOLE: '/system-console',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
