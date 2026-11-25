const PREFIX = 'ops/http-client';

export const HTTP_CLIENT_OPS_ROUTES = {
  PREFIX,
  OVERVIEW: 'overview',
  SERVICES: 'services',
  CIRCUITS: 'circuits',
  CIRCUITS_RESET_ALL: 'circuits/reset-all',
  CIRCUIT_RESET: 'circuits/:service/reset',
  ERRORS: 'errors',
  CONFIG: 'config',
  RESILIENCE: 'resilience',
} as const;
