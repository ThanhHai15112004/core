import { useCallback, useMemo } from 'react';
import type { BaselineMode, ComponentId, PerfFilters, PerfMetric, PerfRange } from '../types/performance.types';
import { useConsoleRoute } from '../context/console-route-context';
import { BASELINE_MODES, COMPONENT_IDS, DEFAULT_PERF_RANGE, PERF_METRICS, PERF_RANGES } from '../constants/performance';
import { toQuery } from '../services/traffic.api';

const SECTION = 'performance';

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | undefined =>
  value && allowed.includes(value as T) ? (value as T) : undefined;

/** Trạng thái trang Performance nằm trên query của hash (chia sẻ được link); `performance/components/<id>` mở drawer. */
export function usePerformanceFilters() {
  const { route, navigate } = useConsoleRoute();
  const q = route.query;

  const filters = useMemo<PerfFilters>(() => {
    const compare = pick<PerfMetric>(q.get('compare'), PERF_METRICS);
    const baseline = pick<BaselineMode>(q.get('baseline'), BASELINE_MODES);
    return {
      range: pick<PerfRange>(q.get('range'), PERF_RANGES) ?? DEFAULT_PERF_RANGE,
      metric: pick<PerfMetric>(q.get('metric'), PERF_METRICS) ?? 'latency',
      ...(compare ? { compare } : {}),
      ...(baseline ? { baseline } : {}),
    };
  }, [q]);

  const component = route.params[0] === 'components' ? pick<ComponentId>(route.params[1] ?? null, COMPONENT_IDS) ?? null : null;

  const pathOf = useCallback((f: PerfFilters, segments: string[]) => {
    const qs = toQuery({
      range: f.range === DEFAULT_PERF_RANGE ? undefined : f.range,
      metric: f.metric === 'latency' ? undefined : f.metric,
      compare: f.compare,
      baseline: f.baseline,
    });
    return `${[SECTION, ...segments].join('/')}${qs ? `?${qs}` : ''}`;
  }, []);

  /** `undefined` = bỏ tham số đó. */
  const setFilters = useCallback(
    (patch: Partial<Record<keyof PerfFilters, string | undefined>>) => {
      const next = { ...filters } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') delete next[k];
        else next[k] = v;
      }
      navigate(pathOf(next as unknown as PerfFilters, route.params));
    },
    [filters, navigate, pathOf, route.params],
  );

  const openComponent = useCallback((id: ComponentId | null) => navigate(pathOf(filters, id ? ['components', id] : [])), [filters, navigate, pathOf]);

  return { filters, component, setFilters, openComponent, navigate };
}
