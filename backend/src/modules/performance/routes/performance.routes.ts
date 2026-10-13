const PREFIX = 'ops/performance';

export const PERFORMANCE_ROUTES = {
  PREFIX,
  OVERVIEW: 'overview',
  TIMESERIES: 'timeseries',
  EVENTS: 'events',
  COMPONENT_DETAIL: 'components/:componentId',
} as const;
