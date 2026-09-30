import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  Delayed,
  Failures,
  JobState,
  QueueDetail,
  QueueJobs,
  QueueRetryResult,
  QueuesList,
  WorkerConfig,
  WorkerDetail,
  WorkerEvent,
  WorkerMetric,
  WorkerMetrics,
  WorkerOperation,
  WorkerOverview,
  WorkerRange,
  WorkersList,
} from '../types/worker.types';
import { toQuery } from './traffic.api';

const W = API_ROUTES.OPS.WORKERS.path;
const Q = API_ROUTES.OPS.QUEUES.path;
const id = (v: string) => encodeURIComponent(v);
const post = <T>(path: string, body: object = {}) => fetchApi<T>(Q(path), { method: 'POST', body: JSON.stringify(body) });

export const workerApi = {
  overview: (range: WorkerRange) => fetchApi<WorkerOverview>(W('overview', toQuery({ range }))),
  metrics: (range: WorkerRange, metric: WorkerMetric, queue?: string) =>
    fetchApi<WorkerMetrics>(queue ? Q(`${id(queue)}/metrics`, toQuery({ range, metric })) : W('metrics', toQuery({ range, metric }))),
  workers: () => fetchApi<WorkersList>(W('')),
  worker: (instance: string) => fetchApi<WorkerDetail>(W(id(instance))),
  failures: (range: WorkerRange, queue?: string) =>
    fetchApi<Failures>(queue ? Q(`${id(queue)}/failures`, toQuery({ range })) : W('failures', toQuery({ range }))),
  delayed: (queue?: string) => fetchApi<Delayed>(W('delayed', toQuery({ queue }))),
  events: (range: WorkerRange, queue?: string) =>
    fetchApi<WorkerEvent[]>(queue ? Q(`${id(queue)}/events`, toQuery({ range })) : W('events', toQuery({ range }))),
  operations: () => fetchApi<WorkerOperation[]>(W('operations')),
  config: () => fetchApi<WorkerConfig>(W('config')),
  queues: (range: WorkerRange) => fetchApi<QueuesList>(Q('', toQuery({ range }))),
  queue: (name: string, range: WorkerRange) => fetchApi<QueueDetail>(Q(id(name), toQuery({ range }))),
  jobs: (name: string, states: JobState[], limit = 50) => fetchApi<QueueJobs>(Q(`${id(name)}/jobs`, toQuery({ state: states.join(','), limit }))),
  pause: (name: string) => post<WorkerOperation>(`${id(name)}/pause`),
  resume: (name: string) => post<WorkerOperation>(`${id(name)}/resume`),
  retryFailed: (name: string, count: number) => post<QueueRetryResult>(`${id(name)}/retry-failed`, { count }),
  drain: (name: string, includeDelayed: boolean) => post<WorkerOperation>(`${id(name)}/drain`, { confirm: 'DRAIN', includeDelayed }),
};
