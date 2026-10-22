export const ROUTES = {
  HOME: '/',
  IAM: '/iam',
  FILES: '/files',
  SYSTEM_CONSOLE: '/system-console',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

