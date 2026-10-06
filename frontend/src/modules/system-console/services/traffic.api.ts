import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  EndpointDetail,
  EndpointRow,
  EndpointSort,
  ErrorAnalysis,
  Timeseries,
  TimeseriesMetric,
  TrafficFilters,
  TrafficInsights,
  TrafficSummary,
} from '../types/traffic.types';

const T = API_ROUTES.OPS.TRAFFIC;

type Params = Record<string, string | number | boolean | undefined>;

/** Chỉ đưa tham số có giá trị vào query string. */
export function toQuery(params: Params): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  return qs.toString();
}

/** Bộ lọc aggregate chung. */
const scope = (f: TrafficFilters): Params => ({
  range: f.range,
  method: f.method,
  module: f.module,
  instance: f.instance,
  internal: f.internal === false ? 'false' : undefined,
});

export const trafficApi = {
  summary: (f: TrafficFilters) => fetchApi<TrafficSummary>(T.SUMMARY(toQuery(scope(f)))),
  timeseries: (f: TrafficFilters, metric: TimeseriesMetric, routeId?: string) =>
    fetchApi<Timeseries>(T.TIMESERIES(toQuery({ ...scope(f), metric, routeId }))),
  endpoints: (f: TrafficFilters, sort: EndpointSort) =>
    fetchApi<EndpointRow[]>(T.ENDPOINTS(toQuery({ ...scope(f), sort }))),
  endpoint: (routeId: string, f: TrafficFilters) =>
    fetchApi<EndpointDetail>(T.ENDPOINT_DETAIL(routeId, toQuery({ range: f.range, instance: f.instance }))),
  errors: (f: TrafficFilters) => fetchApi<ErrorAnalysis>(T.ERRORS(toQuery(scope(f)))),
  insights: (f: TrafficFilters) => fetchApi<TrafficInsights>(T.INSIGHTS(toQuery(scope(f)))),
};
