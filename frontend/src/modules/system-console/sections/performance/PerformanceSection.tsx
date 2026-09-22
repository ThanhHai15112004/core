import React, { useState } from 'react';
import { History, Pause, Play, Radio, WifiOff } from 'lucide-react';
import { performanceApi } from '../../services/performance.api';
import { usePolling } from '../../hooks/usePolling';
import { usePerformanceFilters } from '../../hooks/usePerformanceFilters';
import { LIVE_RANGES, PERF_RANGES } from '../../constants/performance';
import { POLL_INTERVAL_MS } from '../../constants/console.constants';
import { PerfStatusBanner } from '../../components/performance/PerfStatusBanner';
import { PerfKpis } from '../../components/performance/PerfKpis';
import { PerfTimeline } from '../../components/performance/PerfTimeline';
import { ResourcePanel } from '../../components/performance/ResourcePanel';
import { BottleneckList } from '../../components/performance/BottleneckList';
import { LatencyBreakdown } from '../../components/performance/LatencyBreakdown';
import { ComponentTable } from '../../components/performance/ComponentTable';
import { ThroughputFlow } from '../../components/performance/ThroughputFlow';
import { BudgetCapacityPanel } from '../../components/performance/BudgetCapacityPanel';
import { PerfEventsList } from '../../components/performance/PerfEventsList';
import { ComponentDrawer } from '../../components/performance/ComponentDrawer';
import { ApiError } from '../../../../core/services/api';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';
import '../../styles/console-runtimes.css';
import '../../styles/console-traffic.css';
import '../../styles/console-performance.css';

/** Khoảng lịch sử (6h/24h/7d) là dữ liệu đã gộp theo phút/giờ — không cần cập nhật mỗi 5 giây. */
const HISTORICAL_POLL_MS = 60_000;

/**
 * Performance: hệ thống đang nhanh hay chậm, nghẽn ở đâu, bắt đầu từ lúc nào — và dẫn sang màn xử lý
 * (Runtimes, HTTP Traffic, Database, Logs). Chỉ đọc; thao tác nguy hiểm nằm ở đúng subsystem.
 */
export const PerformanceSection: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const { filters, component, setFilters, openComponent, navigate } = usePerformanceFilters();
  const [paused, setPaused] = useState(false);
  const live = LIVE_RANGES.includes(filters.range);
  const intervalMs = live ? POLL_INTERVAL_MS : HISTORICAL_POLL_MS;

  const overview = usePolling(() => performanceApi.overview(filters.range), `ov:${filters.range}`, intervalMs, paused);
  const events = usePolling(() => performanceApi.events(filters.range), `ev:${filters.range}`, intervalMs, paused);
  const data = overview.data;
  const unavailable = overview.error instanceof ApiError && overview.error.status === 503 ? overview.error : null;

  const renderContent = () => {
    if (unavailable) {
      return (
        <section className="tr-empty-state" role="status">
          <WifiOff size={28} />
          <h2>{t('perf.empty.unavailableTitle')}</h2>
          <p>{unavailable.message}</p>
        </section>
      );
    }
    if (overview.error && !data) {
      return (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('ov.offline.title')}</h2>
            <p>{overview.error.message}</p>
          </div>
        </section>
      );
    }
    return (
      <>
        {data && <PerfStatusBanner data={data} />}
        <PerfKpis data={data} />
        <PerfTimeline filters={filters} paused={paused} intervalMs={intervalMs} setFilters={setFilters} />
        {data && (
          <>
            <div className="pf-split">
              <ResourcePanel
                resources={data.resources}
                thresholds={{ cpu: data.settings.thresholds.cpuPercent, memory: data.settings.thresholds.memoryPercent }}
                onOpen={(id) => navigate(`runtimes/${id}`)}
              />
              <BottleneckList bottlenecks={data.bottlenecks} windowMin={data.settings.windowMin} now={now} onInspect={navigate} />
            </div>
            <div className="ov-split">
              <LatencyBreakdown breakdown={data.breakdown} dbActive={data.telemetry.database === 'active'} />
              <ThroughputFlow throughput={data.throughput} />
            </div>
            <ComponentTable rows={data.components} onOpen={openComponent} />
            <BudgetCapacityPanel budgets={data.budgets} capacity={data.capacity} />
          </>
        )}
        <PerfEventsList events={events.data} onOpen={navigate} />
      </>
    );
  };

  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">{t('nav.performance')}</h1>
          <p className="ov-page-subtitle">{t('perf.subtitle')}</p>
        </div>
        <div className="tr-live">
          {live ? (
            <span className={`tr-live-badge ${paused ? 'is-paused' : ''}`}>
              {paused ? <Pause size={12} /> : <Radio size={12} />}
              {paused ? t('tr.live.paused') : t('tr.live.live')}
            </span>
          ) : (
            <span className="tr-live-badge is-paused">
              <History size={12} /> {t('perf.historical')}
            </span>
          )}
          <span className="ov-page-updated">
            <time>{overview.lastUpdated ? formatRelative(overview.lastUpdated, now) : '--'}</time>
          </span>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? t('tr.live.resume') : t('tr.live.pause')}
          </button>
        </div>
      </header>

      <div className="tr-controls">
        <p className="pf-range-hint">{t(live ? 'perf.rangeLive' : 'perf.rangeHistorical')}</p>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
          {PERF_RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={filters.range === r} className={filters.range === r ? 'is-active' : ''} onClick={() => setFilters({ range: r })}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {renderContent()}

      {data && <p className="tr-footnote">{t('perf.footnote', { evaluate: data.settings.evaluateSec, window: data.settings.windowMin })}</p>}

      {component && (
        <ComponentDrawer key={component} id={component} range={filters.range} paused={paused} onClose={() => openComponent(null)} navigate={navigate} />
      )}
    </div>
  );
};
