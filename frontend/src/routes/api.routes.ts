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
      LOGS: (id: string, limit: number, level?: string, correlationId?: string) =>
        `${OPS_PREFIX}/runtimes/${id}/logs?limit=${limit}${level ? `&level=${level}` : ''}${
          correlationId ? `&correlationId=${encodeURIComponent(correlationId)}` : ''
        }`,
      ACTION: (id: string, action: 'restart' | 'stop' | 'start') => `${OPS_PREFIX}/runtimes/${id}/${action}`,
    },
    TRAFFIC: {
      SUMMARY: (qs: string) => `${OPS_PREFIX}/traffic/summary?${qs}`,
      TIMESERIES: (qs: string) => `${OPS_PREFIX}/traffic/timeseries?${qs}`,
      ENDPOINTS: (qs: string) => `${OPS_PREFIX}/traffic/endpoints?${qs}`,
      ENDPOINT_DETAIL: (routeId: string, qs: string) => `${OPS_PREFIX}/traffic/endpoints/${routeId}?${qs}`,
      REQUESTS: (qs: string) => `${OPS_PREFIX}/traffic/requests?${qs}`,
      REQUEST_DETAIL: (requestId: string) => `${OPS_PREFIX}/traffic/requests/${encodeURIComponent(requestId)}`,
      SLOW: (qs: string) => `${OPS_PREFIX}/traffic/slow?${qs}`,
      ERRORS: (qs: string) => `${OPS_PREFIX}/traffic/errors?${qs}`,
      ACTIVE: (qs: string) => `${OPS_PREFIX}/traffic/active?${qs}`,
      INSIGHTS: (qs: string) => `${OPS_PREFIX}/traffic/insights?${qs}`,
    },
    DATABASE: {
      path: (path: string, qs = '') => `${OPS_PREFIX}/database/${path}${qs ? `?${qs}` : ''}`,
    },
    PERFORMANCE: {
      OVERVIEW: (qs: string) => `${OPS_PREFIX}/performance/overview?${qs}`,
      TIMESERIES: (qs: string) => `${OPS_PREFIX}/performance/timeseries?${qs}`,
      EVENTS: (qs: string) => `${OPS_PREFIX}/performance/events?${qs}`,
      COMPONENT: (id: string, qs: string) => `${OPS_PREFIX}/performance/components/${id}?${qs}`,
    },
  },
} as const;
