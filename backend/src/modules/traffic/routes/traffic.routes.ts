const PREFIX = 'ops/traffic';

export const TRAFFIC_ROUTES = {
  PREFIX,
  SUMMARY: 'summary',
  TIMESERIES: 'timeseries',
  ENDPOINTS: 'endpoints',
  ENDPOINT_DETAIL: 'endpoints/:routeId',
  REQUESTS: 'requests',
  REQUEST_DETAIL: 'requests/:requestId',
  SLOW: 'slow',
  ERRORS: 'errors',
  ACTIVE: 'active',
  INSIGHTS: 'insights',
  buildSummaryPath: () => `/${PREFIX}/summary`,
  buildEndpointPath: (routeId: string) => `/${PREFIX}/endpoints/${routeId}`,
  buildRequestPath: (requestId: string) => `/${PREFIX}/requests/${requestId}`,
} as const;
