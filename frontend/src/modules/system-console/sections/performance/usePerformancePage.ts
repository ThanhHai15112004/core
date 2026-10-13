import { useCallback, useMemo } from 'react';
import { setSearchParams } from '@core/router';
import { useTimeRange } from '@core/data';
import type { BaselineMode, ComponentId, PerfFilters, PerfMetric } from '../../types/performance.types';
import { BASELINE_MODES, COMPONENT_IDS, DEFAULT_PERF_METRIC, PERF_METRICS, PERF_RANGES, PERF_TABS, type PerfTab } from '../../constants/performance';
import { useSectionRoute } from '../../shell/useSectionRoute';

const pick = <T extends string>(value: string | null | undefined, allowed: readonly T[]): T | undefined =>
  value && allowed.includes(value as T) ? (value as T) : undefined;

/**
 * Route của Performance: `performance[/<tab>]?metric=&compare=&baseline=`, `?item=<component>` mở drawer thành phần,
 * `?settings=1` mở sheet cấu hình đánh giá. Khoảng thời gian lấy từ thanh trên cùng.
 * Link cũ: `performance/components/<id>` → `bottlenecks/<id>` (vẫn mở drawer); `?range=` cũ bị bỏ qua.
 */
export function usePerformancePage() {
  const r = useSectionRoute<PerfTab>(PERF_TABS, { components: { tab: 'bottlenecks' } });
  const { query, params } = r;
  const range = useTimeRange(PERF_RANGES);

  const filters = useMemo<PerfFilters>(() => {
    const compare = pick<PerfMetric>(query.get('compare'), PERF_METRICS);
    const baseline = pick<BaselineMode>(query.get('baseline'), BASELINE_MODES);
    return {
      range,
      metric: pick<PerfMetric>(query.get('metric'), PERF_METRICS) ?? DEFAULT_PERF_METRIC,
      ...(compare ? { compare } : {}),
      ...(baseline ? { baseline } : {}),
    };
  }, [query, range]);

  const legacyItem = r.tab === 'bottlenecks' ? pick<ComponentId>(params[0], COMPONENT_IDS) : undefined;
  const item = pick<ComponentId>(query.get('item'), COMPONENT_IDS) ?? legacyItem ?? null;

  /** `undefined` / chuỗi rỗng = bỏ tham số đó. */
  const setFilters = useCallback((patch: Partial<Record<'metric' | 'compare' | 'baseline', string | undefined>>) => r.setQuery(patch), [r]);
  const openItem = useCallback(
    (id: ComponentId | null) => {
      if (!id && legacyItem) r.go('bottlenecks');
      else setSearchParams({ item: id }, id ? 'push' : 'replace');
    },
    [r, legacyItem],
  );
  const setSettings = useCallback((open: boolean) => setSearchParams({ settings: open ? '1' : null }, open ? 'push' : 'replace'), []);
  /** Đổi tab, giữ chỉ số / so sánh / drawer đang chọn. */
  const go = useCallback((tab: PerfTab) => r.go(tab, [], Object.fromEntries(query.entries())), [r, query]);

  return {
    tab: r.tab,
    range,
    filters,
    item,
    settingsOpen: query.get('settings') === '1',
    go,
    setFilters,
    openItem,
    setSettings,
    navigate: r.navigate,
  };
}

export type PerformancePage = ReturnType<typeof usePerformancePage>;
