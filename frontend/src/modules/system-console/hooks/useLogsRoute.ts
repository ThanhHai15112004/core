import { useCallback, useMemo } from 'react';
import type { LogFilters, LogsRange, LogsTab, LogsWindow } from '../types/logs.types';
import { useConsoleRoute } from '../context/console-route-context';
import { DEFAULT_LOGS_RANGE, FILTER_KEYS, LOGS_RANGES, LOGS_TABS, LOGS_WINDOWS } from '../constants/logs';
import { toQuery } from '../services/traffic.api';

const SECTION = 'logs';

function filtersOf(q: URLSearchParams): LogFilters {
  const f: LogFilters = {};
  for (const k of FILTER_KEYS) {
    const v = q.get(k)?.trim();
    if (!v) continue;
    if (k === 'window') {
      if (LOGS_WINDOWS.includes(v as LogsWindow)) f.window = v as LogsWindow;
    } else f[k] = v;
  }
  return f;
}

/**
 * `logs/<tab>?range=`, `logs/explorer?level=&jobId=…&log=<id>`, `logs/errors/<fingerprint>`, `logs/traces/<id>` — tab,
 * bộ lọc, log đang mở và trace nằm trên URL: màn khác mở thẳng Logs đã lọc, chia sẻ được, Back hoạt động.
 * Link cũ `logs?runtime=worker&jobId=…` (chưa có tab) mở Explorer với bộ lọc đó.
 */
export function useLogsRoute() {
  const { route, navigate } = useConsoleRoute();
  const [rawTab, rawId] = route.params;
  const filters = useMemo(() => filtersOf(route.query), [route.query]);
  const hasFilters = Object.keys(filters).length > 0;
  const tab: LogsTab = LOGS_TABS.includes(rawTab as LogsTab) ? (rawTab as LogsTab) : hasFilters ? 'explorer' : 'overview';
  const itemId = rawId ? decodeURIComponent(rawId) : null;
  const logId = route.query.get('log');
  const range = useMemo<LogsRange>(() => {
    const r = route.query.get('range') as LogsRange | null;
    return r && LOGS_RANGES.includes(r) ? r : DEFAULT_LOGS_RANGE;
  }, [route.query]);

  const path = useCallback((segments: string[], query: Record<string, string | undefined> = {}) => {
    const qs = toQuery(query);
    return `${[SECTION, ...segments].join('/')}${qs ? `?${qs}` : ''}`;
  }, []);

  const go = useCallback(
    (next: LogsTab, query: Record<string, string | undefined> = {}) =>
      navigate(path(next === 'overview' ? [] : [next], { ...query, range: range === DEFAULT_LOGS_RANGE || next === 'explorer' ? undefined : range })),
    [navigate, path, range],
  );

  /** Explorer với bộ lọc (thay toàn bộ bộ lọc hiện tại). */
  const explore = useCallback((f: LogFilters) => navigate(path(['explorer'], { ...f })), [navigate, path]);

  /** Mở / đóng chi tiết một log (drawer) mà giữ bộ lọc. */
  const openLog = useCallback(
    (id: string | null) => {
      const extra = Object.fromEntries([...route.query.entries()].filter(([k]) => k !== 'log'));
      navigate(path(tab === 'overview' && !rawTab ? [] : [tab, ...(itemId ? [encodeURIComponent(itemId)] : [])], { ...extra, log: id ?? undefined }));
    },
    [navigate, path, route.query, tab, rawTab, itemId],
  );

  const openError = useCallback(
    (fingerprint: string) => navigate(path(['errors', fingerprint], { range: range === DEFAULT_LOGS_RANGE ? undefined : range })),
    [navigate, path, range],
  );
  const openTrace = useCallback((id: string) => navigate(path(['traces', encodeURIComponent(id)])), [navigate, path]);

  const setRange = useCallback(
    (r: LogsRange) => {
      const extra = Object.fromEntries([...route.query.entries()].filter(([k]) => k !== 'range'));
      navigate(path(route.params, { ...extra, range: r === DEFAULT_LOGS_RANGE ? undefined : r }));
    },
    [navigate, path, route.params, route.query],
  );

  return { tab, itemId, logId, range, filters, go, explore, openLog, openError, openTrace, setRange, navigate };
}
