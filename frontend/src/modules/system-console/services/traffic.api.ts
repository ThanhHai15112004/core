import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  ActiveRequests,
  EndpointDetail,
  EndpointRow,
  EndpointSort,
  ErrorAnalysis,
  RequestDetailResponse,
  RequestKind,
  RequestList,
  Timeseries,
  TimeseriesMetric,
  TrafficFilters,
  TrafficInsights,
  TrafficSummary,
} from '../types/traffic.types';
import type { RuntimeLog } from '../types/runtime.types';

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

/** Bộ lọc aggregate chung (không gồm filter chỉ áp dụng cho danh sách request). */
const scope = (f: TrafficFilters, withRange = true): Params => ({
  ...(withRange ? { range: f.range } : {}),
  method: f.method,
  module: f.module,
  instance: f.instance,
  internal: f.internal === false ? 'false' : undefined,
});

export interface RequestListParams {
  kind?: RequestKind;
  routeId?: string;
  minMs?: number;
  limit?: number;
  offset?: number;
}

export const trafficApi = {
  summary: (f: TrafficFilters) => fetchApi<TrafficSummary>(T.SUMMARY(toQuery(scope(f)))),
  timeseries: (f: TrafficFilters, metric: TimeseriesMetric, routeId?: string) =>
    fetchApi<Timeseries>(T.TIMESERIES(toQuery({ ...scope(f), metric, routeId }))),
  endpoints: (f: TrafficFilters, sort: EndpointSort) =>
    fetchApi<EndpointRow[]>(T.ENDPOINTS(toQuery({ ...scope(f), sort }))),
  endpoint: (routeId: string, f: TrafficFilters) =>
    fetchApi<EndpointDetail>(T.ENDPOINT_DETAIL(routeId, toQuery({ range: f.range, instance: f.instance }))),
  requests: (f: TrafficFilters, p: RequestListParams = {}) =>
    fetchApi<RequestList>(
      T.REQUESTS(
        toQuery({
          ...scope(f),
          status: f.status,
          q: f.q,
          minMs: p.minMs ?? f.minMs,
          kind: p.kind,
          routeId: p.routeId,
          limit: p.limit,
          offset: p.offset,
        }),
      ),
    ),
  request: (id: string) => fetchApi<RequestDetailResponse>(T.REQUEST_DETAIL(id)),
  errors: (f: TrafficFilters) => fetchApi<ErrorAnalysis>(T.ERRORS(toQuery(scope(f)))),
  active: (f: TrafficFilters) => fetchApi<ActiveRequests>(T.ACTIVE(toQuery(scope(f, false)))),
  insights: (f: TrafficFilters) => fetchApi<TrafficInsights>(T.INSIGHTS(toQuery(scope(f)))),
  /** Log của runtime API cùng correlation id với request. */
  relatedLogs: (correlationId: string, limit = 200) =>
    fetchApi<RuntimeLog[]>(API_ROUTES.OPS.RUNTIMES.LOGS('api', limit, undefined, correlationId)),
};
