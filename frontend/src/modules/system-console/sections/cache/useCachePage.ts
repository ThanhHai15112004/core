import { useCallback, useMemo } from 'react';
import { setSearchParams } from '@core/router';
import { useTimeRange } from '@core/data';
import type { CacheRange, CacheTab, KeyFilter } from '../../types/cache.types';
import { CACHE_RANGES, CACHE_TAB_ALIASES, CACHE_TABS, KEY_TTL_FILTERS, type CachePageTab } from '../../constants/cache';
import { useSectionRoute } from '../../shell/useSectionRoute';

/**
 * Route của Cache: `cache[/<tab>]?…`
 *   `?ns=<name>` mở chi tiết namespace, `?key=<key>` mở chi tiết key (ở mọi tab), `?settings=1` mở cấu hình.
 *   Keys: `?match=&type=&ttl=&namespace=` là bộ lọc.
 * Link cũ: `cache/memory|ttl|connections` → Tổng quan, `cache/events|operations` → Hoạt động,
 *   `cache/namespaces/<name>` → `?ns=`, `cache/keys/<key>` → `?key=`, `cache/configuration` → cấu hình.
 */
export function useCachePage() {
  const r = useSectionRoute<CachePageTab>(CACHE_TABS, CACHE_TAB_ALIASES);
  const { query, params, tab } = r;
  const range = useTimeRange<CacheRange>(CACHE_RANGES);

  const filter = useMemo<KeyFilter>(() => {
    const ttl = query.get('ttl') as KeyFilter['ttl'] | null;
    return {
      match: query.get('match') ?? '',
      type: query.get('type') ?? '',
      ttl: ttl && KEY_TTL_FILTERS.includes(ttl) ? ttl : 'any',
      namespace: query.get('namespace') ?? '',
    };
  }, [query]);

  // Đường dẫn cũ dạng segment (`namespaces/<name>`, `keys/<key>`) vẫn mở đúng drawer.
  const nsId = query.get('ns') ?? (tab === 'namespaces' && params[0] ? decodeURIComponent(params[0]) : null);
  const keyId = query.get('key') ?? (tab === 'keys' && params[0] ? decodeURIComponent(params[0]) : null);

  const go = useCallback((next: CachePageTab, q?: Record<string, string | undefined>) => r.go(next, [], q), [r]);
  /** Tab của backend (có thể là tab cũ) → tab mới. */
  const goLegacy = useCallback(
    (raw: CacheTab, q?: Record<string, string | undefined>) => {
      const alias = CACHE_TAB_ALIASES[raw];
      const next = (CACHE_TABS as readonly string[]).includes(raw) ? (raw as CachePageTab) : (alias?.tab ?? 'overview');
      if (alias?.query?.settings) setSearchParams({ settings: '1' }, 'push');
      else r.go(next, [], q);
    },
    [r],
  );
  const setFilter = useCallback(
    (patch: Partial<KeyFilter>) => {
      const next = { ...filter, ...patch };
      r.setQuery({ match: next.match || null, type: next.type || null, ttl: next.ttl === 'any' ? null : next.ttl, namespace: next.namespace || null });
    },
    [filter, r],
  );
  /** Mở các bộ lọc Keys từ nơi khác (namespace, TTL). */
  const browseKeys = useCallback((f: Partial<KeyFilter>) => r.go('keys', [], { namespace: f.namespace, ttl: f.ttl === 'any' ? undefined : f.ttl, match: f.match, type: f.type }), [r]);

  /** Drawer / sheet: thêm vào lịch sử để nút Back đóng được. */
  const openNamespace = useCallback(
    (name: string | null) => {
      if (!name && params.length > 0) return r.go(tab, [], { ...Object.fromEntries(query.entries()), ns: undefined });
      setSearchParams({ ns: name, key: null }, name ? 'push' : 'replace');
    },
    [params.length, query, r, tab],
  );
  const openKey = useCallback(
    (key: string | null) => {
      if (!key && params.length > 0) return r.go(tab, [], { ...Object.fromEntries(query.entries()), key: undefined });
      setSearchParams({ key, ns: null }, key ? 'push' : 'replace');
    },
    [params.length, query, r, tab],
  );
  const setSettings = useCallback((open: boolean) => setSearchParams({ settings: open ? '1' : null }, open ? 'push' : 'replace'), []);

  return {
    tab,
    range,
    filter,
    nsId,
    keyId,
    settingsOpen: query.get('settings') === '1',
    go,
    goLegacy,
    setFilter,
    browseKeys,
    openNamespace,
    openKey,
    setSettings,
    navigate: r.navigate,
  };
}

export type CachePage = ReturnType<typeof useCachePage>;
