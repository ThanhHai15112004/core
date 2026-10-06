const PREFIX = 'ops/traffic';

export const TRAFFIC_ROUTES = {
  PREFIX,
  SUMMARY: 'summary',
  TIMESERIES: 'timeseries',
  ENDPOINTS: 'endpoints',
  ENDPOINT_DETAIL: 'endpoints/:routeId',
  ERRORS: 'errors',
  INSIGHTS: 'insights',
  buildSummaryPath: () => `/${PREFIX}/summary`,
  buildEndpointPath: (routeId: string) => `/${PREFIX}/endpoints/${routeId}`,
} as const;
