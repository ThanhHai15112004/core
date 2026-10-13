import type { ComponentId, PerfFilters, PerfRange } from '../../types/performance.types';

/** Query key của Performance. Biểu đồ Tổng quan (`['overview','perf',…]`) dùng key riêng. */
export const perfKeys = {
  all: ['performance'] as const,
  overview: (range: PerfRange) => ['performance', 'overview', range] as const,
  timeseries: (f: PerfFilters) => ['performance', 'timeseries', f.range, f.metric, f.compare ?? null, f.baseline ?? null] as const,
  events: (range: PerfRange) => ['performance', 'events', range] as const,
  component: (id: ComponentId, range: PerfRange) => ['performance', 'component', id, range] as const,
};
