const PREFIX = 'ops/metrics';

export const METRICS_OPS_ROUTES = {
  PREFIX,
  OVERVIEW: 'overview',
  ERRORS_BY_MODULE: 'errors-by-module',
  DEPENDENCIES: 'dependencies',
  ALERT_RULES: 'alerts/rules',
  ALERT_RULE_BY_ID: 'alerts/rules/:id',
  ALERT_RULE_TEST: 'alerts/rules/:id/test',
  ALERT_EVENTS: 'alerts/events',
  ALERT_EVENT_ACK: 'alerts/events/:id/acknowledge',
  ALERT_EVENT_RESOLVE: 'alerts/events/:id/resolve',
  ALERTS_EVALUATE: 'alerts/evaluate',
} as const;
