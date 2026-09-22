import { useCallback, useMemo } from 'react';
import type { StorageRange, StorageTab } from '../types/storage.types';
import { useConsoleRoute } from '../context/console-route-context';
import { STORAGE_RANGES, STORAGE_TABS, DEFAULT_STORAGE_RANGE } from '../constants/storage';
import { toQuery } from '../services/traffic.api';

const SECTION = 'storage';

/** `storage/<tab>/<id>?range=` — tab, đối tượng đang mở (container/object) và khoảng thời gian nằm trên URL. */
export function useStorageRoute() {
  const { route, navigate } = useConsoleRoute();
  const [rawTab, id] = route.params;
  const tab: StorageTab = STORAGE_TABS.includes(rawTab as StorageTab) ? (rawTab as StorageTab) : 'overview';
  const range = useMemo<StorageRange>(() => {
    const r = route.query.get('range') as StorageRange | null;
    return r && STORAGE_RANGES.includes(r) ? r : DEFAULT_STORAGE_RANGE;
  }, [route.query]);
  const extra = useMemo(() => Object.fromEntries([...route.query.entries()].filter(([k]) => k !== 'range')), [route.query]);

  const go = useCallback(
    (nextTab: StorageTab, nextId?: string | null, query: Record<string, string | number | undefined> = {}) => {
      const qs = toQuery({ range: range === DEFAULT_STORAGE_RANGE ? undefined : range, ...query });
      const segments = [SECTION, ...(nextTab === 'overview' && !nextId ? [] : [nextTab]), ...(nextId ? [encodeURIComponent(nextId)] : [])];
      navigate(`${segments.join('/')}${qs ? `?${qs}` : ''}`);
    },
    [navigate, range],
  );

  const setRange = useCallback(
    (r: StorageRange) => {
      const qs = toQuery({ ...extra, range: r === DEFAULT_STORAGE_RANGE ? undefined : r });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [extra, navigate, route.params],
  );

  const setQuery = useCallback(
    (patch: Record<string, string | number | undefined>) => {
      const qs = toQuery({ ...extra, ...patch, range: range === DEFAULT_STORAGE_RANGE ? undefined : range });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [extra, navigate, range, route.params],
  );

  return { tab, id: id ? decodeURIComponent(id) : null, range, query: extra, go, setRange, setQuery, navigate };
}
