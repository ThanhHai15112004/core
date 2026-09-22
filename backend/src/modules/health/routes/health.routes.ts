const PREFIX = 'health';

export const HEALTH_ROUTES = {
  PREFIX,
  CHECK: '',
  buildCheckPath: () => `/${PREFIX}`,
} as const;
