import { useCallback, useMemo } from 'react';
import { setHashQuery } from '@core/hooks/useQueryState';
import { useTimeRange } from '@core/data';
import type { LogFilters, LogsRange, LogsTab, LogsWindow } from '../../types/logs.types';
import { FILTER_KEYS, LOGS_RANGES, LOGS_TABS, LOGS_WINDOWS } from '../../constants/logs';
import { useSectionRoute } from '../../shell/useSectionRoute';

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

const toQuery = (f: LogFilters) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
};

/**
 * Route của Logs:
 *   `logs[/<tab>]`, `logs/explorer?level=&jobId=…`, `logs/errors/<fingerprint>`, `logs/traces[/<id>]` (trang con),
 *   `?log=<id>` mở drawer chi tiết, `?settings=1` mở sheet cấu hình.
 * Link cũ: `logs/configuration` → sheet cấu hình; `logs?runtime=…` (có bộ lọc, không tab) → Explorer.
 */
export function useLogsPage() {
  const r = useSectionRoute<LogsTab>(LOGS_TABS, { configuration: { tab: 'overview', query: { settings: '1' } } });
  const { navigate, query } = r;
  const filters = useMemo(() => filtersOf(query), [query]);
  const isTrace = r.tab === 'overview' && r.params[0] === 'traces';
  const traceId = isTrace ? (r.params[1] ?? null) : null;
  const hasFilters = Object.keys(filters).length > 0;
  const tab: LogsTab = !isTrace && r.tab === 'overview' && r.params.length === 0 && hasFilters ? 'explorer' : r.tab;
  const itemId = tab === 'errors' ? (r.params[0] ?? null) : null;
  const range = useTimeRange<LogsRange>(LOGS_RANGES);

  const go = useCallback((next: LogsTab) => r.go(next), [r]);
  const explore = useCallback((f: LogFilters) => navigate(`logs/explorer${toQuery(f)}`), [navigate]);
  const openError = useCallback((fp: string) => r.go('errors', [fp]), [r]);
  const openTrace = useCallback((id?: string) => navigate(id ? `logs/traces/${encodeURIComponent(id)}` : 'logs/traces'), [navigate]);
  /** Drawer / sheet: thêm vào lịch sử để nút Back đóng được. */
  const openLog = useCallback((id: string | null) => setHashQuery({ log: id }, id ? 'push' : 'replace'), []);
  const setSettings = useCallback((open: boolean) => setHashQuery({ settings: open ? '1' : null }, open ? 'push' : 'replace'), []);

  return {
    tab,
    isTrace,
    traceId,
    itemId,
    range,
    filters,
    logId: query.get('log'),
    settingsOpen: query.get('settings') === '1',
    go,
    explore,
    openError,
    openTrace,
    openLog,
    setSettings,
    navigate,
  };
}

export type LogsPage = ReturnType<typeof useLogsPage>;
