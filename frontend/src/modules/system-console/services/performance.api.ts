import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type { ComponentDetail, ComponentId, PerfEvent, PerfFilters, PerfRange, PerfTimeseries, PerformanceOverview } from '../types/performance.types';
import { toQuery } from './traffic.api';

const P = API_ROUTES.OPS.PERFORMANCE;

export const performanceApi = {
  overview: (range: PerfRange) => fetchApi<PerformanceOverview>(P.OVERVIEW(toQuery({ range }))),
  timeseries: (f: PerfFilters) =>
    fetchApi<PerfTimeseries>(P.TIMESERIES(toQuery({ range: f.range, metric: f.metric, compare: f.compare, baseline: f.baseline }))),
  events: (range: PerfRange) => fetchApi<PerfEvent[]>(P.EVENTS(toQuery({ range }))),
  component: (id: ComponentId, range: PerfRange) => fetchApi<ComponentDetail>(P.COMPONENT(id, toQuery({ range }))),
};
