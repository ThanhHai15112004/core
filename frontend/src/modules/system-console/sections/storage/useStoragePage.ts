import { useCallback, useEffect, useMemo } from 'react';
import { navigateTo, setSearchParams } from '@core/router';
import { ROUTES } from '../../../../routes/index';
import { useConsoleRoute } from '../../context/console-route-context';
import { useTimeRange } from '@core/data';
import type { ObjectAge, ObjectFilter, ObjectKind, StorageRange, StorageTab } from '../../types/storage.types';
import { OBJECT_AGES, OBJECT_KINDS, STORAGE_RANGES, STORAGE_TAB_ALIASES, STORAGE_TABS, type StoragePageTab } from '../../constants/storage';
import { useSectionRoute } from '../../shell/useSectionRoute';

/**
 * Route của Storage: `storage[/<tab>]?…`
 *   `?detail=<container>` mở chi tiết container, `?object=<key>` mở chi tiết object (ở mọi tab), `?settings=1` mở cấu hình.
 *   Container & Object: `?container=&prefix=&kind=&age=&minSizeMb=` là bộ lọc object.
 * Link cũ: `storage/containers` → Container & Object, `storage/usage|lifecycle` → Tổng quan,
 *   `storage/errors|operations` → Hoạt động, `storage/containers/<name>` → `?detail=`, `storage/objects/<key>` → `?object=`.
 */
export function useStoragePage() {
  const r = useSectionRoute<StoragePageTab>(STORAGE_TABS, STORAGE_TAB_ALIASES);
  const { query, params, tab } = r;
  const range = useTimeRange<StorageRange>(STORAGE_RANGES);
  // `storage/objects/<key>` cũ: segment sau tab là object.
  const legacyId = tab === 'objects' && params[0] ? decodeURIComponent(params[0]) : null;
  // `storage/containers/<name>` cũ → `storage/objects?detail=<name>` (chạy sau redirect alias nên thắng).
  const { route } = useConsoleRoute();
  const legacyContainer = route.params[0] === 'containers' ? route.params[1] : undefined;
  useEffect(() => {
    if (legacyContainer) navigateTo(`${ROUTES.SYSTEM_CONSOLE}/${route.section}/objects?detail=${encodeURIComponent(decodeURIComponent(legacyContainer))}`, 'replace');
  }, [legacyContainer, route.section]);

  const filter = useMemo<ObjectFilter>(() => {
    const kind = query.get('kind') as ObjectKind | null;
    const age = query.get('age') as ObjectAge | null;
    return {
      container: query.get('container') ?? '',
      prefix: query.get('prefix') ?? '',
      kind: kind && OBJECT_KINDS.includes(kind) ? kind : '',
      age: age && OBJECT_AGES.includes(age) ? age : '',
      minSizeMb: query.get('minSizeMb') ?? '',
    };
  }, [query]);

  const containerId = query.get('detail');
  const objectId = query.get('object') ?? legacyId;

  const go = useCallback((next: StoragePageTab, q?: Record<string, string | undefined>) => r.go(next, [], q), [r]);
  /** Tab của backend (có thể là tab cũ) → tab mới. */
  const goLegacy = useCallback(
    (raw: StorageTab) => {
      const alias = STORAGE_TAB_ALIASES[raw];
      if (alias?.query?.settings) return setSearchParams({ settings: '1' }, 'push');
      r.go((STORAGE_TABS as readonly string[]).includes(raw) ? (raw as StoragePageTab) : (alias?.tab ?? 'overview'));
    },
    [r],
  );
  const setFilter = useCallback(
    (patch: Partial<ObjectFilter>) => {
      const next = { ...filter, ...patch };
      r.setQuery({ container: next.container || null, prefix: next.prefix || null, kind: next.kind || null, age: next.age || null, minSizeMb: next.minSizeMb || null });
    },
    [filter, r],
  );
  /** Mở danh sách object đã lọc từ nơi khác (container, loại file). */
  const browseObjects = useCallback((f: Partial<ObjectFilter>) => r.go('objects', [], { container: f.container, kind: f.kind || undefined, prefix: f.prefix }), [r]);

  const closeLegacy = useCallback((drop: string) => r.go(tab, [], { ...Object.fromEntries(query.entries()), [drop]: undefined }), [query, r, tab]);
  /** Drawer: thêm vào lịch sử để nút Back đóng được. */
  const openContainer = useCallback(
    (name: string | null) => setSearchParams({ detail: name, object: null }, name ? 'push' : 'replace'),
    [],
  );
  const openObject = useCallback(
    (key: string | null) => (!key && legacyId !== null ? closeLegacy('object') : setSearchParams({ object: key, detail: null }, key ? 'push' : 'replace')),
    [closeLegacy, legacyId],
  );
  const setSettings = useCallback((open: boolean) => setSearchParams({ settings: open ? '1' : null }, open ? 'push' : 'replace'), []);

  return {
    tab,
    range,
    filter,
    containerId,
    objectId,
    settingsOpen: query.get('settings') === '1',
    go,
    goLegacy,
    setFilter,
    browseObjects,
    openContainer,
    openObject,
    setSettings,
    navigate: r.navigate,
  };
}

export type StoragePage = ReturnType<typeof useStoragePage>;
