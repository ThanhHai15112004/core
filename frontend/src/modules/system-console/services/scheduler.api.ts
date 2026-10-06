import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  CronInspect,
  ExecutionDetail,
  ExecutionsList,
  ExecutionStatus,
  ExecutionTrigger,
  RunNowResult,
  SchedulerConfig,
  SchedulerFailures,
  SchedulerMetric,
  SchedulerMetrics,
  SchedulerOperation,
  SchedulerOverview,
  SchedulerRange,
  SchedulerTimeline,
  TaskDetail,
  TasksList,
  UpcomingList,
} from '../types/scheduler.types';
import { toQuery } from './traffic.api';

const S = API_ROUTES.OPS.SCHEDULER.path;
const id = (v: string) => encodeURIComponent(v);
const post = <T>(path: string) => fetchApi<T>(S(path), { method: 'POST', body: JSON.stringify({}) });

export interface ExecutionFilter {
  range: SchedulerRange;
  task?: string;
  status?: ExecutionStatus[];
  trigger?: ExecutionTrigger[];
  limit?: number;
}

const filterQuery = (f: ExecutionFilter) =>
  toQuery({
    range: f.range,
    task: f.task,
    status: f.status?.length ? f.status.join(',') : undefined,
    trigger: f.trigger?.length ? f.trigger.join(',') : undefined,
    limit: f.limit,
  });

export const schedulerApi = {
  overview: (range: SchedulerRange) => fetchApi<SchedulerOverview>(S('overview', toQuery({ range }))),
  metrics: (range: SchedulerRange, metric: SchedulerMetric, task?: string) => fetchApi<SchedulerMetrics>(S('metrics', toQuery({ range, metric, task }))),
  tasks: () => fetchApi<TasksList>(S('tasks')),
  task: (taskId: string, range: SchedulerRange) => fetchApi<TaskDetail>(S(`tasks/${id(taskId)}`, toQuery({ range }))),
  executions: (f: ExecutionFilter) => fetchApi<ExecutionsList>(S('executions', filterQuery(f))),
  execution: (executionId: string) => fetchApi<ExecutionDetail>(S(`executions/${id(executionId)}`)),
  upcoming: (hours: number) => fetchApi<UpcomingList>(S('upcoming', toQuery({ hours }))),
  timeline: (range: SchedulerRange) => fetchApi<SchedulerTimeline>(S('timeline', toQuery({ range }))),
  failures: (range: SchedulerRange) => fetchApi<SchedulerFailures>(S('failures', toQuery({ range }))),
  operations: () => fetchApi<SchedulerOperation[]>(S('operations')),
  config: () => fetchApi<SchedulerConfig>(S('config')),
  cron: (expression: string, timezone?: string) => fetchApi<CronInspect>(S('cron', toQuery({ expression, timezone }))),
  run: (taskId: string) => post<RunNowResult>(`tasks/${id(taskId)}/run`),
  enable: (taskId: string) => post<SchedulerOperation>(`tasks/${id(taskId)}/enable`),
  disable: (taskId: string) => post<SchedulerOperation>(`tasks/${id(taskId)}/disable`),
};
