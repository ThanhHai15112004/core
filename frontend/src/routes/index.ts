export const ROUTES = {
  HOME: '/',
  SYSTEM_OPS: '/admin/ops',
  SYSTEM_CONSOLE: '#system-console',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
