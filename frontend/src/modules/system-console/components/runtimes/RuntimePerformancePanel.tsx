import React, { useState } from 'react';
import type { MetricRange, RuntimeId, RuntimeSample } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { usePolling } from '../../hooks/usePolling';
import { LineChart, type ChartPoint, type ChartSeries } from '../common/LineChart';
import { useLocale } from '../../../../core/i18n/index';

type PerfMetric = 'cpu' | 'memory' | 'restarts' | 'eventLoop';

const METRICS: PerfMetric[] = ['cpu', 'memory', 'restarts', 'eventLoop'];
const RANGES: MetricRange[] = ['15m', '1h', '6h', '24h'];
const UNITS: Record<PerfMetric, string> = { cpu: '%', memory: 'MB', restarts: '', eventLoop: 'ms' };
const COLORS: Record<RuntimeId, string> = {
  api: 'var(--scp-series-1)',
  worker: 'var(--scp-series-2)',
  scheduler: 'var(--scp-series-3)',
};

/** Chuyển mẫu thật thành điểm vẽ; `restarts` = số lần start tăng thêm giữa 2 mẫu liên tiếp. */
function toPoints(samples: RuntimeSample[], metric: PerfMetric): ChartPoint[] {
  return samples.map((s, i) => {
    switch (metric) {
      case 'cpu':
        return { t: s.t, value: s.cpu };
      case 'memory':
        return { t: s.t, value: s.mem };
      case 'eventLoop':
        return { t: s.t, value: s.elp99 };
      case 'restarts':
        return { t: s.t, value: i === 0 ? 0 : Math.max(0, s.starts - (samples[i - 1]?.starts ?? s.starts)) };
    }
  });
}

interface RuntimePerformancePanelProps {
  /** Cố định 1 runtime (trang chi tiết) hoặc cho chọn (trang danh sách). */
  runtime?: RuntimeId;
  names: Record<string, string>;
}

/** Biểu đồ chung so sánh các runtime theo CPU/RAM/Restart/Event loop, dữ liệu time-series thật từ Redis. */
export const RuntimePerformancePanel: React.FC<RuntimePerformancePanelProps> = ({ runtime, names }) => {
  const { t, formatTime } = useLocale();
  const [metric, setMetric] = useState<PerfMetric>('cpu');
  const [range, setRange] = useState<MetricRange>('15m');
  const [selected, setSelected] = useState<RuntimeId | 'all'>('all');

  const { data } = usePolling(
    () => (runtime ? runtimesApi.runtimeSeries(runtime, range) : runtimesApi.series(range)),
    `${runtime ?? 'all'}:${range}`,
  );

  const ids = (Object.keys(data ?? {}) as RuntimeId[]).filter((id) => runtime || selected === 'all' || id === selected);
  const series: ChartSeries[] = ids.map((id) => ({
    id,
    label: names[id] ?? id,
    color: COLORS[id],
    points: toPoints(data?.[id] ?? [], metric),
  }));

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('rt.performance.title')}</h3>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
          {RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
              {t(`chart.range${r}`)}
            </button>
          ))}
        </div>
      </header>

      <div className="rt-perf-controls">
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.metric')}>
          {METRICS.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={metric === m} className={metric === m ? 'is-active' : ''} onClick={() => setMetric(m)}>
              {t(`rt.performance.metric.${m}`)}
            </button>
          ))}
        </div>
        {!runtime && (
          <div className="ov-segmented" role="tablist" aria-label={t('rt.performance.runtime')}>
            {(['all', 'api', 'worker', 'scheduler'] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={selected === id} className={selected === id ? 'is-active' : ''} onClick={() => setSelected(id)}>
                {id === 'all' ? t('console.logs.level.all') : (names[id] ?? id)}
              </button>
            ))}
          </div>
        )}
      </div>

      <LineChart
        series={series}
        unit={UNITS[metric]}
        formatTime={(ts) => formatTime(ts, false)}
        emptyText={t('rt.performance.empty')}
        ariaLabel={t('rt.performance.title')}
      />
    </section>
  );
};
