const PREFIX = 'ops/runtimes';

export const RUNTIMES_ROUTES = {
  PREFIX,
  LIST: '',
  METRICS_ALL: 'metrics',
  EVENTS: 'events',
  COMMAND: 'commands/:commandId',
  DETAIL: ':runtimeId',
  METRICS: ':runtimeId/metrics',
  LOGS: ':runtimeId/logs',
  STOP: ':runtimeId/stop',
  START: ':runtimeId/start',
  buildListPath: () => `/${PREFIX}`,
  buildMetricsAllPath: () => `/${PREFIX}/metrics`,
  buildEventsPath: () => `/${PREFIX}/events`,
  buildCommandPath: (commandId: string) => `/${PREFIX}/commands/${commandId}`,
  buildDetailPath: (id: string) => `/${PREFIX}/${id}`,
  buildMetricsPath: (id: string) => `/${PREFIX}/${id}/metrics`,
  buildLogsPath: (id: string) => `/${PREFIX}/${id}/logs`,
  buildActionPath: (id: string, action: 'stop' | 'start') => `/${PREFIX}/${id}/${action}`,
} as const;
