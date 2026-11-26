const PREFIX = 'ops/runtimes';

export const RUNTIMES_ROUTES = {
  PREFIX,
  LIST: '',
  METRICS_ALL: 'metrics',
  EVENTS: 'events',
  AUTOSCALING: 'autoscaling',
  AUTOSCALING_SIMULATE: 'autoscaling/simulate',
  AUTOSCALING_HPA: 'autoscaling/hpa',
  COMMAND: 'commands/:commandId',
  DETAIL: ':runtimeId',
  METRICS: ':runtimeId/metrics',
  LOGS: ':runtimeId/logs',
  STOP: ':runtimeId/stop',
  START: ':runtimeId/start',
  buildListPath: () => `/${PREFIX}`,
  buildMetricsAllPath: () => `/${PREFIX}/metrics`,
  buildEventsPath: () => `/${PREFIX}/events`,
  buildAutoscalingPath: () => `/${PREFIX}/autoscaling`,
  buildAutoscalingSimulatePath: () => `/${PREFIX}/autoscaling/simulate`,
  buildAutoscalingHpaPath: (target?: 'api' | 'worker') =>
    target ? `/${PREFIX}/autoscaling/hpa?target=${target}` : `/${PREFIX}/autoscaling/hpa`,
  buildCommandPath: (commandId: string) => `/${PREFIX}/commands/${commandId}`,
  buildDetailPath: (id: string) => `/${PREFIX}/${id}`,
  buildMetricsPath: (id: string) => `/${PREFIX}/${id}/metrics`,
  buildLogsPath: (id: string) => `/${PREFIX}/${id}/logs`,
  buildActionPath: (id: string, action: 'stop' | 'start') => `/${PREFIX}/${id}/${action}`,
} as const;
