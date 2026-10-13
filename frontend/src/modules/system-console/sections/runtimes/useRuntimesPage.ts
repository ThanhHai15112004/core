import { useCallback, useEffect } from 'react';
import { navigateTo, setSearchParams } from '@core/router';
import { ROUTES } from '../../../../routes/index';
import type { RuntimeId } from '../../types/runtime.types';
import { useConsoleRoute } from '../../context/console-route-context';
import { RUNTIME_DETAIL_TABS, RUNTIME_IDS, RUNTIME_TAB_ALIASES, type RuntimeDetailTab } from '../../constants/runtime-metrics';

const isTab = (v: string | undefined): v is RuntimeDetailTab => v !== undefined && (RUNTIME_DETAIL_TABS as readonly string[]).includes(v);
const isRuntime = (v: string | undefined): v is RuntimeId => v !== undefined && (RUNTIME_IDS as string[]).includes(v);

/**
 * Route của Runtimes:
 *   `runtimes` → danh sách (`?item=cli` mở sheet CLI),
 *   `runtimes/<id>[/<tab>]` → chi tiết (Tổng quan · Metrics · Logs & Sự kiện), `?settings=1` mở sheet cấu hình.
 * Link cũ: `processes` → Tổng quan, `events` → Logs & Sự kiện, `configuration` → Tổng quan + sheet cấu hình.
 */
export function useRuntimesPage() {
  const { route, navigate } = useConsoleRoute();
  const [rawId, rawTab] = route.params;
  const id = isRuntime(rawId) ? rawId : null;
  const alias = id && rawTab && !isTab(rawTab) ? RUNTIME_TAB_ALIASES[rawTab] : undefined;
  const tab: RuntimeDetailTab = isTab(rawTab) ? rawTab : (alias?.tab ?? RUNTIME_DETAIL_TABS[0]);

  const pathOf = useCallback((rid: RuntimeId, next: RuntimeDetailTab) => `runtimes/${rid}${next === RUNTIME_DETAIL_TABS[0] ? '' : `/${next}`}`, []);

  useEffect(() => {
    if (!id || !alias) return;
    const qs = new URLSearchParams(route.query);
    for (const [k, v] of Object.entries(alias.query ?? {})) qs.set(k, v);
    const s = qs.toString();
    navigateTo(`${ROUTES.SYSTEM_CONSOLE}/${pathOf(id, alias.tab)}${s ? `?${s}` : ''}`, 'replace');
  }, [id, alias, route.query, pathOf]);

  const go = useCallback((next: RuntimeDetailTab) => id && navigate(pathOf(id, next)), [id, navigate, pathOf]);
  const open = useCallback((rid: RuntimeId) => navigate(pathOf(rid, RUNTIME_DETAIL_TABS[0])), [navigate, pathOf]);
  const back = useCallback(() => navigate('runtimes'), [navigate]);
  /** Drawer / sheet: thêm vào lịch sử để nút Back đóng được. */
  const setSettings = useCallback((v: boolean) => setSearchParams({ settings: v ? '1' : null }, v ? 'push' : 'replace'), []);
  const openItem = useCallback((item: string | null) => setSearchParams({ item }, item ? 'push' : 'replace'), []);

  return {
    id,
    tab,
    item: route.query.get('item'),
    settingsOpen: route.query.get('settings') === '1',
    go,
    open,
    back,
    setSettings,
    openItem,
    navigate,
  };
}

export type RuntimesPage = ReturnType<typeof useRuntimesPage>;
