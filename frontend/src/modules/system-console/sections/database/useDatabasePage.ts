import { useCallback, useEffect } from 'react';
import { navigateTo, setSearchParams } from '@core/router';
import { useTimeRange } from '@core/data';
import type { DbTab } from '../../types/database.types';
import {
  DB_QUERY_VIEWS,
  DB_RANGES,
  DB_TAB_ALIASES,
  DB_TABLE_VIEWS,
  DB_TABS,
  LEGACY_TAB_TARGET,
  LIVE_STATE_FILTERS,
  SLOW_THRESHOLDS,
  type DbPageTab,
  type DbQueryView,
  type DbTableView,
  type LiveStateFilter,
} from '../../constants/database';
import { useSectionRoute } from '../../shell/useSectionRoute';
import { useConsoleRoute } from '../../context/console-route-context';
import { ROUTES } from '../../../../routes/index';

const pick = <T extends string>(list: readonly T[], v: string | null): T => (v && (list as readonly string[]).includes(v) ? (v as T) : list[0]);

/**
 * Route của Database:
 *   `database[/<tab>]?view=` (segment trong tab), `?state=&minMs=&runtime=` (bộ lọc),
 *   `?digest=` / `?session=` / `?table=` mở drawer chi tiết, `?settings=1` mở sheet cấu hình.
 * Link cũ: `database/<tab cũ>` → tab + segment mới; `database/<tab>/<id>` → drawer tương ứng.
 */
export function useDatabasePage() {
  const r = useSectionRoute<DbPageTab>(DB_TABS, DB_TAB_ALIASES);
  const { query, params, tab } = r;
  const range = useTimeRange(DB_RANGES);
  const queryView = pick<DbQueryView>(DB_QUERY_VIEWS, query.get('view'));
  const tableView = pick<DbTableView>(DB_TABLE_VIEWS, query.get('view'));
  const minMsRaw = Number(query.get('minMs') ?? 0);
  const minMs = (SLOW_THRESHOLDS as readonly number[]).includes(minMsRaw) ? minMsRaw : 0;

  /** Link cũ có id trong path → chuyển sang query mở drawer (replace, không thêm lịch sử). */
  const { route } = useConsoleRoute();
  const settled = (DB_TABS as readonly string[]).includes(route.params[0] ?? '');
  const legacyId = settled && params[0] ? params[0] : null;
  useEffect(() => {
    if (!legacyId) return;
    const key = tab === 'tables' ? 'table' : tab === 'queries' ? (queryView === 'queries' ? 'digest' : 'session') : null;
    const qs = new URLSearchParams(query);
    if (key) qs.set(key, decodeURIComponent(legacyId));
    navigateTo(`${ROUTES.SYSTEM_CONSOLE}/${route.section}/${tab}?${qs.toString()}`, 'replace');
  }, [legacyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTab = useCallback((next: DbPageTab) => r.go(next), [r]);
  const goView = useCallback((next: DbPageTab, view: string) => r.go(next, [], { view: view === DB_QUERY_VIEWS[0] || view === DB_TABLE_VIEWS[0] ? undefined : view }), [r]);
  /** Đích của `tab` cũ do backend trả về (cảnh báo, sự kiện). */
  const goLegacy = useCallback((old: DbTab | null) => {
    if (!old) return;
    const target = LEGACY_TAB_TARGET[old];
    r.go(target.tab, [], target.query);
  }, [r]);
  const setFilter = useCallback((patch: Record<string, string | number | undefined>) => r.setQuery(patch), [r]);

  /** Drawer / sheet: thêm vào lịch sử để nút Back đóng được. */
  const open = useCallback((key: 'digest' | 'session' | 'table', id: string | null) => setSearchParams({ [key]: id }, id ? 'push' : 'replace'), []);
  const openQuery = useCallback((id: string | null) => open('digest', id), [open]);
  const openSession = useCallback((id: string | null) => open('session', id), [open]);
  const openTable = useCallback((id: string | null) => open('table', id), [open]);
  const setSettings = useCallback((on: boolean) => setSearchParams({ settings: on ? '1' : null }, on ? 'push' : 'replace'), []);

  return {
    tab,
    range,
    queryView,
    tableView,
    stateFilter: pick<LiveStateFilter>(LIVE_STATE_FILTERS, query.get('state')),
    minMs,
    runtimeFilter: query.get('runtime'),
    digestId: query.get('digest'),
    sessionId: query.get('session'),
    tableName: query.get('table'),
    settingsOpen: query.get('settings') === '1',
    goTab,
    goView,
    goLegacy,
    setFilter,
    openQuery,
    openSession,
    openTable,
    setSettings,
    navigate: r.navigate,
  };
}

export type DatabasePage = ReturnType<typeof useDatabasePage>;
