import { useCallback, useEffect, useMemo } from 'react';
import { navigateTo, setSearchParams } from '@core/router';
import { useLive, useTimeRange } from '@core/data';
import { TIME_RANGES, type TimeRange } from '@core/constants/ui.constants';
import { ROUTES } from '../../../../routes/index';
import type { TrafficFilters } from '../../types/traffic.types';
import { useConsoleRoute } from '../../context/console-route-context';
import { useSectionRoute } from '../../shell/useSectionRoute';
import {
  DEFAULT_SORT_COLUMN,
  ENDPOINT_STATUS_FILTERS,
  HTTP_METHODS,
  SORT_COLUMN,
  TRAFFIC_RANGES,
  TRAFFIC_TAB_ALIASES,
  TRAFFIC_TABS,
  type EndpointStatusFilter,
  type TrafficScope,
  type TrafficTab,
} from '../../constants/traffic';
import { routeIdOf } from '../../utils/traffic-format';

type QueryPatch = Record<string, string | null | undefined>;

const isOneOf = <T extends string>(list: readonly T[], v: string | null): v is T => v !== null && (list as readonly string[]).includes(v);

/**
 * Route của HTTP Traffic:
 *   `http-traffic[/<tab>]`, `http-traffic/endpoints/<routeId>` (trang chi tiết endpoint),
 *   query `method`, `scope=app` (bỏ traffic nội bộ), `status`, `q`, `sort` (bảng endpoint).
 * Link cũ: `requests` / `slow` → Endpoints; `requests/<requestId>` → Logs; `?range=` → bộ chọn thời gian chung;
 * `?internal=false` → `scope=app`; `endpoints/<id>/<tab>` → trang endpoint (một trang, không còn tab con).
 */
export function useTrafficPage() {
  const { route } = useConsoleRoute();
  const { setRange } = useLive();
  const legacyRequest = route.params[0] === 'requests' && route.params[1] ? route.params[1] : null;
  const r = useSectionRoute<TrafficTab>(TRAFFIC_TABS, legacyRequest ? {} : TRAFFIC_TAB_ALIASES);
  const { query, navigate } = r;
  const range = useTimeRange(TRAFFIC_RANGES);

  // Request không còn lưu riêng — chi tiết một request xem ở Logs.
  useEffect(() => {
    if (legacyRequest) navigateTo(`${ROUTES.SYSTEM_CONSOLE}/logs/explorer?requestId=${encodeURIComponent(legacyRequest)}`, 'replace');
  }, [legacyRequest]);

  const legacyRange = query.get('range');
  const legacyInternal = query.get('internal');
  useEffect(() => {
    if (legacyRange === null && legacyInternal === null) return;
    if (isOneOf<TimeRange>(TIME_RANGES, legacyRange)) setRange(legacyRange);
    setSearchParams({ range: null, internal: null, ...(legacyInternal === 'false' ? { scope: 'app' } : {}) }, 'replace');
  }, [legacyRange, legacyInternal, setRange]);

  const rawMethod = query.get('method');
  const rawStatus = query.get('status');
  const method = isOneOf(HTTP_METHODS, rawMethod) ? rawMethod : undefined;
  const scope: TrafficScope = query.get('scope') === 'app' ? 'app' : 'all';
  const status: EndpointStatusFilter | undefined = isOneOf(ENDPOINT_STATUS_FILTERS, rawStatus) ? rawStatus : undefined;
  const search = query.get('q') ?? '';
  const sortColumn = SORT_COLUMN[query.get('sort') ?? ''] ?? DEFAULT_SORT_COLUMN;

  const filters = useMemo<TrafficFilters>(() => ({ range, internal: scope === 'all', ...(method ? { method } : {}) }), [range, scope, method]);

  const routeId = r.tab === 'endpoints' ? routeIdOf(r.params) : null;

  /** Query giữ lại khi chuyển tab / mở endpoint. */
  const keep = useMemo(() => ({ method, scope: scope === 'app' ? 'app' : undefined }), [method, scope]);

  /** Chuyển tab, giữ method / scope (và bộ lọc bảng khi về Endpoints); `extra` vd. `{ sort: 'p95' }`. */
  const go = useCallback(
    (tab: TrafficTab, extra?: QueryPatch) => r.go(tab, [], { ...keep, ...(tab === 'endpoints' ? { status, q: search || undefined } : {}), ...extra }),
    [r, keep, status, search],
  );
  const openEndpoint = useCallback((id: string) => r.go('endpoints', [id], keep), [r, keep]);
  const setFilter = useCallback((patch: QueryPatch) => r.setQuery(patch), [r]);
  const clearFilters = useCallback(() => r.setQuery({ method: null, scope: null, status: null, q: null }), [r]);
  /** Từng request không lưu ở Traffic — mở Logs lọc theo endpoint / status. */
  const openLogs = useCallback((q: Record<string, string>) => navigate(`logs/explorer?${new URLSearchParams(q).toString()}`), [navigate]);

  return {
    tab: r.tab,
    routeId,
    range,
    filters,
    method,
    scope,
    status,
    search,
    sortColumn,
    hasFilters: Boolean(method || scope !== 'all' || status || search),
    go,
    openEndpoint,
    setFilter,
    clearFilters,
    openLogs,
    navigate,
  };
}

export type TrafficPage = ReturnType<typeof useTrafficPage>;
