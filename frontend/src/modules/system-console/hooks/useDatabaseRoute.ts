import { useCallback, useMemo } from 'react';
import type { DbRange, DbTab } from '../types/database.types';
import { useConsoleRoute } from '../context/console-route-context';
import { DB_RANGES, DB_TABS, DEFAULT_DB_RANGE } from '../constants/database';
import { toQuery } from '../services/traffic.api';

const SECTION = 'database';

/** `database/<tab>/<id>?range=` — tab, đối tượng đang mở (query/session/bảng) và khoảng thời gian nằm trên URL. */
export function useDatabaseRoute() {
  const { route, navigate } = useConsoleRoute();
  const [rawTab, id] = route.params;
  const tab: DbTab = DB_TABS.includes(rawTab as DbTab) ? (rawTab as DbTab) : 'overview';
  const range = useMemo<DbRange>(() => {
    const r = route.query.get('range') as DbRange | null;
    return r && DB_RANGES.includes(r) ? r : DEFAULT_DB_RANGE;
  }, [route.query]);
  const extra = useMemo(() => Object.fromEntries([...route.query.entries()].filter(([k]) => k !== 'range')), [route.query]);

  const go = useCallback(
    (nextTab: DbTab, nextId?: string | null, query: Record<string, string | number | undefined> = {}) => {
      const qs = toQuery({ range: range === DEFAULT_DB_RANGE ? undefined : range, ...query });
      const segments = [SECTION, ...(nextTab === 'overview' && !nextId ? [] : [nextTab]), ...(nextId ? [encodeURIComponent(nextId)] : [])];
      navigate(`${segments.join('/')}${qs ? `?${qs}` : ''}`);
    },
    [navigate, range],
  );

  const setRange = useCallback(
    (r: DbRange) => {
      const qs = toQuery({ ...extra, range: r === DEFAULT_DB_RANGE ? undefined : r });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [extra, navigate, route.params],
  );

  const setQuery = useCallback(
    (patch: Record<string, string | number | undefined>) => {
      const qs = toQuery({ ...extra, ...patch, range: range === DEFAULT_DB_RANGE ? undefined : range });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [extra, navigate, range, route.params],
  );

  return { tab, id: id ? decodeURIComponent(id) : null, range, query: extra, go, setRange, setQuery, navigate };
}
