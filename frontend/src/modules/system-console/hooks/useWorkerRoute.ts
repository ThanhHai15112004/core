import { useCallback, useMemo } from 'react';
import type { QueueDetailTab, WorkerRange, WorkerTab } from '../types/worker.types';
import { useConsoleRoute } from '../context/console-route-context';
import { DEFAULT_WORKER_RANGE, QUEUE_DETAIL_TABS, WORKER_RANGES, WORKER_TABS } from '../constants/worker';
import { toQuery } from '../services/traffic.api';

const SECTION = 'worker';
type Query = Record<string, string | number | undefined>;

/**
 * `worker/<tab>/<id>/<sub>?range=` — tab, đối tượng đang mở (worker instance → drawer, queue → Queue Detail) và
 * tab con của Queue Detail nằm trên URL (chia sẻ được, Back hoạt động).
 */
export function useWorkerRoute() {
  const { route, navigate } = useConsoleRoute();
  const [rawTab, rawId, rawSub] = route.params;
  const tab: WorkerTab = WORKER_TABS.includes(rawTab as WorkerTab) ? (rawTab as WorkerTab) : 'overview';
  const sub: QueueDetailTab = QUEUE_DETAIL_TABS.includes(rawSub as QueueDetailTab) ? (rawSub as QueueDetailTab) : 'overview';
  const range = useMemo<WorkerRange>(() => {
    const r = route.query.get('range') as WorkerRange | null;
    return r && WORKER_RANGES.includes(r) ? r : DEFAULT_WORKER_RANGE;
  }, [route.query]);
  const extra = useMemo(() => Object.fromEntries([...route.query.entries()].filter(([k]) => k !== 'range')), [route.query]);

  const build = useCallback(
    (segments: string[], query: Query) => {
      const qs = toQuery({ ...query, range: range === DEFAULT_WORKER_RANGE ? undefined : range });
      navigate(`${[SECTION, ...segments].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [navigate, range],
  );

  const go = useCallback(
    (nextTab: WorkerTab, nextId?: string | null, query: Query = {}) =>
      build([...(nextTab === 'overview' && !nextId ? [] : [nextTab]), ...(nextId ? [encodeURIComponent(nextId)] : [])], query),
    [build],
  );

  /** Mở Queue Detail (tab con tuỳ chọn). */
  const openQueue = useCallback(
    (name: string, subTab: QueueDetailTab = 'overview', query: Query = {}) =>
      build(['queues', encodeURIComponent(name), ...(subTab === 'overview' ? [] : [subTab])], query),
    [build],
  );

  const setRange = useCallback(
    (r: WorkerRange) => {
      const qs = toQuery({ ...extra, range: r === DEFAULT_WORKER_RANGE ? undefined : r });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [extra, navigate, route.params],
  );

  return { tab, id: rawId ? decodeURIComponent(rawId) : null, sub, range, query: extra, go, openQueue, setRange, navigate };
}
