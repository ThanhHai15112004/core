import { useCallback, useMemo } from 'react';
import type { EndpointSort, TrafficFilters, TrafficRange } from '../types/traffic.types';
import { useConsoleRoute } from '../context/console-route-context';
import { DEFAULT_RANGE, ENDPOINT_SORTS, TRAFFIC_RANGES } from '../constants/traffic';
import { toQuery } from '../services/traffic.api';

const SECTION = 'http-traffic';

/** Bộ lọc HTTP Traffic nằm trên query của hash → giữ khi đổi tab, chia sẻ được link. */
export function useTrafficFilters() {
  const { route, navigate } = useConsoleRoute();
  const q = route.query;

  const filters = useMemo<TrafficFilters>(() => {
    const range = q.get('range') as TrafficRange | null;
    const sort = q.get('sort') as EndpointSort | null;
    const minMs = Number(q.get('minMs'));
    return {
      range: range && TRAFFIC_RANGES.includes(range) ? range : DEFAULT_RANGE,
      internal: q.get('internal') !== 'false',
      ...(q.get('method') ? { method: q.get('method')! } : {}),
      ...(q.get('module') ? { module: q.get('module')! } : {}),
      ...(q.get('instance') ? { instance: q.get('instance')! } : {}),
      ...(q.get('status') ? { status: q.get('status')! } : {}),
      ...(q.get('q') ? { q: q.get('q')! } : {}),
      ...(Number.isFinite(minMs) && minMs > 0 ? { minMs } : {}),
      ...(sort && ENDPOINT_SORTS.includes(sort) ? { sort } : {}),
    };
  }, [q]);

  const queryOf = useCallback(
    (f: TrafficFilters) =>
      toQuery({
        range: f.range === DEFAULT_RANGE ? undefined : f.range,
        method: f.method,
        module: f.module,
        instance: f.instance,
        internal: f.internal === false ? 'false' : undefined,
        status: f.status,
        q: f.q,
        minMs: f.minMs,
        sort: f.sort,
      }),
    [],
  );

  /** Đường dẫn trong section, giữ nguyên bộ lọc hiện tại. */
  const pathTo = useCallback(
    (segments: string[], patch: Partial<TrafficFilters> = {}) => {
      const qs = queryOf({ ...filters, ...patch });
      return `${[SECTION, ...segments].join('/')}${qs ? `?${qs}` : ''}`;
    },
    [filters, queryOf],
  );

  const go = useCallback((segments: string[], patch?: Partial<TrafficFilters>) => navigate(pathTo(segments, patch)), [navigate, pathTo]);

  /** Đổi bộ lọc tại trang hiện tại. `undefined` = bỏ filter đó. */
  const setFilters = useCallback(
    (patch: Partial<Record<keyof TrafficFilters, unknown>>) => {
      const next = { ...filters } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') delete next[k];
        else next[k] = v;
      }
      const qs = queryOf(next as unknown as TrafficFilters);
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [filters, navigate, queryOf, route.params],
  );

  return { filters, params: route.params, setFilters, go, pathTo, navigate };
}
