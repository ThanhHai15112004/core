import { useCallback, useEffect, useMemo } from 'react';
import { useConsoleRoute } from '../context/console-route-context';

export interface TabAlias<T extends string> {
  tab: T;
  /** Query thêm khi chuyển link cũ (vd. tab `retries` cũ → `messages?state=retry`). */
  query?: Record<string, string>;
}

type QueryInput = Record<string, string | number | null | undefined>;

function toQueryString(query?: QueryInput): string {
  if (!query) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * Route của một section: `#system-console/<section>/<tab>/<...params>?query`.
 * Tab mặc định (phần tử đầu) không ghi lên URL. Link cũ theo `aliases` được đổi sang tab mới (replace, không thêm lịch sử).
 */
export function useSectionRoute<T extends string>(tabs: readonly T[], aliases: Partial<Record<string, TabAlias<T>>> = {}) {
  const { route, navigate } = useConsoleRoute();
  const raw = route.params[0];
  const isTab = (v: string | undefined): v is T => v !== undefined && (tabs as readonly string[]).includes(v);
  const alias = raw && !isTab(raw) ? aliases[raw] : undefined;
  const tab: T = isTab(raw) ? raw : (alias?.tab ?? tabs[0]);
  const params = useMemo(() => (isTab(raw) || alias ? route.params.slice(1) : route.params), [route.params, raw, alias]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback(
    (next: T, segments: (string | number)[] = [], query?: QueryInput) => {
      const parts = [route.section, ...(next === tabs[0] && segments.length === 0 ? [] : [next]), ...segments.map((s) => encodeURIComponent(String(s)))];
      navigate(`${parts.join('/')}${toQueryString(query)}`);
    },
    [navigate, route.section, tabs],
  );

  /** Giữ tab hiện tại, chỉ đổi query. */
  const setQuery = useCallback(
    (patch: QueryInput) => {
      const merged: QueryInput = Object.fromEntries(route.query.entries());
      Object.assign(merged, patch);
      go(tab, params, merged);
    },
    [go, tab, params, route.query],
  );

  useEffect(() => {
    if (!alias) return;
    const merged: QueryInput = { ...Object.fromEntries(route.query.entries()), ...alias.query };
    const parts = [route.section, alias.tab, ...params].join('/');
    window.history.replaceState(window.history.state, '', `#system-console/${parts}${toQueryString(merged)}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [alias, params, route.query, route.section]);

  return { section: route.section, tab, params, query: route.query, go, setQuery, navigate };
}
