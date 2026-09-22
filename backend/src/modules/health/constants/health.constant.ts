export const HEALTH_ROUTES = {
  PREFIX: 'health',
  CHECK: '',
  buildCheckPath: () => '/health',
} as const;
