import { useCallback, useMemo } from 'react';
import type { CacheRange, CacheTab } from '../types/cache.types';
import { useConsoleRoute } from '../context/console-route-context';
import { CACHE_RANGES, CACHE_TABS, DEFAULT_CACHE_RANGE } from '../constants/cache';
import { toQuery } from '../services/traffic.api';

const SECTION = 'cache';

/** `cache/<tab>/<id>?range=` — tab, đối tượng đang mở (namespace/key) và khoảng thời gian nằm trên URL. */
export function useCacheRoute() {
  const { route, navigate } = useConsoleRoute();
  const [rawTab, id] = route.params;
  const tab: CacheTab = CACHE_TABS.includes(rawTab as CacheTab) ? (rawTab as CacheTab) : 'overview';
  const range = useMemo<CacheRange>(() => {
    const r = route.query.get('range') as CacheRange | null;
    return r && CACHE_RANGES.includes(r) ? r : DEFAULT_CACHE_RANGE;
  }, [route.query]);
  const extra = useMemo(() => Object.fromEntries([...route.query.entries()].filter(([k]) => k !== 'range')), [route.query]);

  const go = useCallback(
    (nextTab: CacheTab, nextId?: string | null, query: Record<string, string | number | undefined> = {}) => {
      const qs = toQuery({ range: range === DEFAULT_CACHE_RANGE ? undefined : range, ...query });
      const segments = [SECTION, ...(nextTab === 'overview' && !nextId ? [] : [nextTab]), ...(nextId ? [encodeURIComponent(nextId)] : [])];
      navigate(`${segments.join('/')}${qs ? `?${qs}` : ''}`);
    },
    [navigate, range],
  );

  const setRange = useCallback(
    (r: CacheRange) => {
      const qs = toQuery({ ...extra, range: r === DEFAULT_CACHE_RANGE ? undefined : r });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [extra, navigate, route.params],
  );

  const setQuery = useCallback(
    (patch: Record<string, string | number | undefined>) => {
      const qs = toQuery({ ...extra, ...patch, range: range === DEFAULT_CACHE_RANGE ? undefined : range });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [extra, navigate, range, route.params],
  );

  return { tab, id: id ? decodeURIComponent(id) : null, range, query: extra, go, setRange, setQuery, navigate };
}
