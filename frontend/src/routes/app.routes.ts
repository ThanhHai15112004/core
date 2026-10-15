export const ROUTES = {
  HOME: '/',
  IAM: '/iam',
  SYSTEM_CONSOLE: '/system-console',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

