import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  CliExecution,
  MetricRange,
  RestartMode,
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
  detail: (id: RuntimeId) => fetchApi<RuntimeDetail>(R.DETAIL(id)),
  series: (range: MetricRange) => fetchApi<RuntimeSeries>(R.METRICS_ALL(range)),
  runtimeSeries: (id: RuntimeId, range: MetricRange) => fetchApi<RuntimeSeries>(R.METRICS(id, range)),
  events: (limit: number, runtime?: RuntimeId) => fetchApi<RuntimeEvent[]>(R.EVENTS(limit, runtime)),
  logs: (id: RuntimeId | 'cli', limit: number, level?: string) => fetchApi<RuntimeLog[]>(R.LOGS(id, limit, level)),
  cliHistory: (limit: number) => fetchApi<CliExecution[]>(R.CLI_HISTORY(limit)),
  command: (commandId: string) => fetchApi<RuntimeCommand>(R.COMMAND(commandId)),
  restart: (id: RuntimeId, mode: RestartMode) =>
    fetchApi<RuntimeCommand>(R.ACTION(id, 'restart'), { method: 'POST', body: JSON.stringify({ mode }) }),
  stop: (id: RuntimeId, confirm: string) =>
    fetchApi<RuntimeCommand>(R.ACTION(id, 'stop'), { method: 'POST', body: JSON.stringify({ confirm }) }),
  start: (id: RuntimeId) => fetchApi<RuntimeCommand>(R.ACTION(id, 'start'), { method: 'POST', body: '{}' }),
};
