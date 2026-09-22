import { useState, useCallback } from 'react';
import type {
  OverviewData,
  PerformanceDataPoint,
  PerformanceMetricKey,
  PerformanceTimeRange,
} from '../types/console.types';

/** Một lần đo thật lấy từ `/ops/overview`; `null` = backend không có số liệu. */
interface MetricSample {
  at: number;
  values: Record<PerformanceMetricKey, number | null>;
}

export interface PerformanceStats {
  current: string;
  average: string;
  peak: string;
}

const RANGE_MS: Record<PerformanceTimeRange, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

const UNITS: Record<PerformanceMetricKey, string> = {
  requests: 'req/s',
  latency: 'ms',
  errors: '%',
  cpu: '%',
  memory: 'GB',
};

/* 24h với chu kỳ refresh 5s ≈ 17k mẫu; giới hạn để không phình bộ nhớ. */
const MAX_SAMPLES = 5_000;
const EMPTY_STATS: PerformanceStats = { current: '--', average: '--', peak: '--' };

function toNumber(value: string | number | undefined): number | null {
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function extractSample(overview: OverviewData): MetricSample {
  const metric = (id: string) => overview.keyMetrics.find((m) => m.id === id)?.value;
  const info = overview.systemInfo;

  return {
    at: Date.now(),
    values: {
      requests: toNumber(metric('req_sec')),
      latency: toNumber(metric('p95_lat')),
      errors: toNumber(metric('err_rate')),
      cpu: toNumber(metric('cpu_load')),
      memory: info ? Number((info.totalMemGb - info.freeMemGb).toFixed(2)) : null,
    },
  };
}

function formatValue(metric: PerformanceMetricKey, value: number): string {
  return `${Number(value.toFixed(2))} ${UNITS[metric]}`;
}

/**
 * Lưu lịch sử số đo thật mỗi lần refresh overview. Chỉ có dữ liệu từ lúc mở trang,
 * không nội suy hay mô phỏng điểm nào.
 */
export function useMetricHistory() {
  const [samples, setSamples] = useState<MetricSample[]>([]);

  const recordOverview = useCallback((overview: OverviewData) => {
    setSamples((prev) => [...prev, extractSample(overview)].slice(-MAX_SAMPLES));
  }, []);

  const buildSeries = useCallback(
    (
      metric: PerformanceMetricKey,
      range: PerformanceTimeRange,
      formatTime: (at: number) => string,
    ): { series: PerformanceDataPoint[]; stats: PerformanceStats } => {
      const cutoff = Date.now() - RANGE_MS[range];
      const series = samples
        .filter((s) => s.at >= cutoff && s.values[metric] !== null)
        .map((s) => ({ time: formatTime(s.at), value: s.values[metric] as number }));

      if (series.length === 0) {
        return { series, stats: EMPTY_STATS };
      }

      const values = series.map((p) => p.value);
      const average = values.reduce((a, b) => a + b, 0) / values.length;
      return {
        series,
        stats: {
          current: formatValue(metric, values[values.length - 1] ?? 0),
          average: formatValue(metric, average),
          peak: formatValue(metric, Math.max(...values)),
        },
      };
    },
    [samples],
  );

  return { recordOverview, buildSeries };
}
