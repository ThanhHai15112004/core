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
  WORKFLOWS: '/workflows',
  CALENDAR: '/calendar',
  CUSTOM_FIELDS: '/custom-fields',
  WEBHOOKS: '/webhooks',
  PAYMENTS: '/payments',
  PROVIDER_REGISTRY: '/provider-registry',
  OUTBOX: '/outbox',
  IDEMPOTENCY: '/idempotency',
  SYSTEM_CONSOLE: '/system-console',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
