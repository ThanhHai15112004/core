/**
 * Backend API endpoints (relative to `frontendConfig.apiBaseUrl`).
 * Must stay in sync with backend `modules/<module>/routes/*.routes.ts`.
 */
const HEALTH_PREFIX = '/health';
const OPS_PREFIX = '/ops';

export const API_ROUTES = {
  HEALTH: HEALTH_PREFIX,
  OPS: {
    OVERVIEW: `${OPS_PREFIX}/overview`,
    PACKAGES: `${OPS_PREFIX}/packages`,
    PACKAGE_DETAIL: (packageId: string) => `${OPS_PREFIX}/packages/${packageId}`,
    EXECUTE_ACTION: (packageId: string, actionId: string) =>
      `${OPS_PREFIX}/packages/${packageId}/actions/${actionId}`,
  },
} as const;
