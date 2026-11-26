import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  AutoscalingHpa,
  AutoscalingOverview,
  AutoscalingTarget,
  MetricRange,
  RuntimeCommand,
  RuntimeDetail,
  RuntimeEvent,
  RuntimeId,
  RuntimeLog,
  RuntimeSeries,
  RuntimesOverview,
} from '../types/runtime.types';

const R = API_ROUTES.OPS.RUNTIMES;

export const runtimesApi = {
  overview: () => fetchApi<RuntimesOverview>(R.LIST),
  autoscaling: () => fetchApi<AutoscalingOverview>(R.AUTOSCALING),
  autoscalingHpa: (target: AutoscalingTarget) => fetchApi<AutoscalingHpa>(R.AUTOSCALING_HPA(target)),
  detail: (id: RuntimeId) => fetchApi<RuntimeDetail>(R.DETAIL(id)),
  series: (range: MetricRange) => fetchApi<RuntimeSeries>(R.METRICS_ALL(range)),
  runtimeSeries: (id: RuntimeId, range: MetricRange) => fetchApi<RuntimeSeries>(R.METRICS(id, range)),
  events: (limit: number, runtime?: RuntimeId) => fetchApi<RuntimeEvent[]>(R.EVENTS(limit, runtime)),
  logs: (id: RuntimeId | 'cli', limit: number, level?: string) => fetchApi<RuntimeLog[]>(R.LOGS(id, limit, level)),
  command: (commandId: string) => fetchApi<RuntimeCommand>(R.COMMAND(commandId)),
  stop: (id: RuntimeId, confirm: string) =>
    fetchApi<RuntimeCommand>(R.ACTION(id, 'stop'), { method: 'POST', body: JSON.stringify({ confirm }) }),
  start: (id: RuntimeId) => fetchApi<RuntimeCommand>(R.ACTION(id, 'start'), { method: 'POST', body: '{}' }),
};
