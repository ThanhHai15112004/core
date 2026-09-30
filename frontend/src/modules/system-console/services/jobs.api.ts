import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  JobBulkRetryResult,
  JobCancelResult,
  JobDetail,
  JobEvent,
  JobFilters,
  JobOperation,
  JobRow,
  JobSearchResult,
  JobsConfig,
  JobsFailures,
  JobsOverview,
  JobsRange,
  JobsReportResponse,
} from '../types/jobs.types';
import { toQuery } from './traffic.api';

const J = API_ROUTES.OPS.JOBS.path;
const id = (v: string) => encodeURIComponent(v);
const send = <T>(method: 'POST' | 'DELETE', path: string, body?: object, qs = '') =>
  fetchApi<T>(J(path, qs), {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

export const jobsApi = {
  overview: (range: JobsRange) => fetchApi<JobsOverview>(J('overview', toQuery({ range }))),
  search: (filters: JobFilters, cursor?: string | null, limit = 50) =>
    fetchApi<JobSearchResult>(J('', toQuery({ ...filters, cursor: cursor ?? undefined, limit }))),
  job: (jobId: string, queue?: string | null) => fetchApi<JobDetail>(J(id(jobId), toQuery({ queue: queue ?? undefined }))),
  payload: (jobId: string, queue: string) => fetchApi<{ payload: unknown; malformed: boolean }>(J(`${id(jobId)}/payload`, toQuery({ queue }))),
  failures: (range: JobsRange, queue?: string) => fetchApi<JobsFailures>(J('failures', toQuery({ range, queue }))),
  report: (range: JobsRange) => fetchApi<JobsReportResponse>(J('report', toQuery({ range }))),
  events: (range: JobsRange) => fetchApi<JobEvent[]>(J('events', toQuery({ range }))),
  operations: () => fetchApi<JobOperation[]>(J('operations')),
  config: () => fetchApi<JobsConfig>(J('config')),
  retry: (jobId: string, queue: string) => send<{ operation: JobOperation; job: JobRow }>('POST', `${id(jobId)}/retry`, { queue }),
  bulkRetry: (jobs: { queue: string; id: string }[]) => send<JobBulkRetryResult>('POST', 'retry', { jobs }),
  cancel: (jobId: string, queue: string, reason?: string) =>
    send<JobCancelResult>('POST', `${id(jobId)}/cancel`, {
      queue,
      ...(reason ? { reason } : {}),
    }),
  remove: (jobId: string, queue: string) => send<JobOperation>('DELETE', id(jobId), undefined, toQuery({ queue })),
};
