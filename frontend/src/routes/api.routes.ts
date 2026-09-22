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
    RUNTIMES: {
      LIST: `${OPS_PREFIX}/runtimes`,
      METRICS_ALL: (range: string) => `${OPS_PREFIX}/runtimes/metrics?range=${range}`,
      EVENTS: (limit: number, runtime?: string) =>
        `${OPS_PREFIX}/runtimes/events?limit=${limit}${runtime ? `&runtime=${runtime}` : ''}`,
      CLI_HISTORY: (limit: number) => `${OPS_PREFIX}/runtimes/cli/history?limit=${limit}`,
      COMMAND: (commandId: string) => `${OPS_PREFIX}/runtimes/commands/${commandId}`,
      DETAIL: (id: string) => `${OPS_PREFIX}/runtimes/${id}`,
      METRICS: (id: string, range: string) => `${OPS_PREFIX}/runtimes/${id}/metrics?range=${range}`,
      LOGS: (id: string, limit: number, level?: string) =>
        `${OPS_PREFIX}/runtimes/${id}/logs?limit=${limit}${level ? `&level=${level}` : ''}`,
      ACTION: (id: string, action: 'restart' | 'stop' | 'start') => `${OPS_PREFIX}/runtimes/${id}/${action}`,
    },
  },
} as const;
