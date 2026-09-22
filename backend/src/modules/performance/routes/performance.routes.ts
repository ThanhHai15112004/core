const PREFIX = 'ops/performance';

export const PERFORMANCE_ROUTES = {
  PREFIX,
  OVERVIEW: 'overview',
  TIMESERIES: 'timeseries',
  BOTTLENECKS: 'bottlenecks',
  EVENTS: 'events',
  COMPONENT_DETAIL: 'components/:componentId',
  buildOverviewPath: () => `/${PREFIX}/overview`,
  buildComponentPath: (id: string) => `/${PREFIX}/components/${id}`,
} as const;
