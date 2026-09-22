import React from 'react';
import { TrendingUp } from 'lucide-react';
import type { RuntimeResource } from '../../types/performance.types';
import { formatMb, NO_VALUE, percent } from '../../utils/runtime-format';
import { formatUnit } from '../../utils/performance-format';
import { toneOf } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

interface ResourcePanelProps {
  resources: RuntimeResource[];
  thresholds: { cpu: number; memory: number };
  onOpen: (runtimeId: string) => void;
}

const Bar: React.FC<{ value: number | null; threshold: number }> = ({ value, threshold }) => (
  <span className={`rt-bar ${value === null ? 'is-empty' : value >= threshold ? 'is-high' : ''}`} role="meter" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
    {value !== null && <span style={{ width: `${Math.min(100, value)}%` }} />}
  </span>
);

/**
 * Tài nguyên theo runtime: CPU (hiện tại / trung bình / đỉnh), bộ nhớ so với giới hạn, event loop, GC.
 * Bấm một dòng để mở Runtimes > runtime đó.
 */
export const ResourcePanel: React.FC<ResourcePanelProps> = ({ resources, thresholds, onOpen }) => {
  const { t, formatTime } = useLocale();
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('perf.resources.title')}</h3>
        <span className="ov-section-hint">{t('perf.resources.hint')}</span>
      </header>
      <div className="pf-resource-list">
        {resources.map((r) => {
          const alive = r.cpuPercent !== null;
          const memUsed = r.memoryLimitSource === 'cgroup' ? r.rssMb : r.heapUsedMb;
          return (
            <button key={r.id} type="button" className="pf-resource" onClick={() => onOpen(r.id)}>
              <span className="pf-resource-name">
                <span className={`ov-dot ov-tone-${toneOf(r.status)}`} aria-hidden="true" />
                <strong>{r.name}</strong>
                <small>{alive ? t('perf.resources.instances', { count: r.instances }) : t('perf.resources.offline')}</small>
              </span>
              <span className="pf-resource-metric">
                <span className="rt-resource-label">
                  {t('perf.resources.cpu')} <b>{percent(r.cpuPercent)}</b>
                </span>
                <Bar value={r.cpuPercent} threshold={thresholds.cpu} />
                <small>
                  {t('perf.resources.cpuStats', { avg: percent(r.cpuAvgPercent), peak: percent(r.cpuPeakPercent) })}
                  {r.cpuPeakAt && ` @ ${formatTime(Date.parse(r.cpuPeakAt))}`}
                </small>
              </span>
              <span className="pf-resource-metric">
                <span className="rt-resource-label">
                  {t('perf.resources.memory')} <b>{alive ? `${formatMb(memUsed)} / ${formatMb(r.memoryLimitMb)}` : NO_VALUE}</b>
                </span>
                <Bar value={r.memoryPercent} threshold={thresholds.memory} />
                <small>
                  {alive
                    ? t('perf.resources.memoryStats', { rss: formatMb(r.rssMb), heap: formatMb(r.heapUsedMb), external: formatMb(r.externalMb) })
                    : NO_VALUE}
                </small>
              </span>
              <span className="pf-resource-metric">
                <span className="rt-resource-label">{t('perf.resources.eventLoop')}</span>
                <b>{formatUnit(r.eventLoopP99Ms, 'ms')}</b>
                <small>{t('perf.resources.peak', { value: formatUnit(r.eventLoopPeakMs, 'ms') })}</small>
              </span>
              <span className="pf-resource-metric">
                <span className="rt-resource-label">{t('perf.resources.gc')}</span>
                <b>{r.gcPerMin === null ? NO_VALUE : t('perf.resources.gcPerMin', { count: r.gcPerMin })}</b>
                <small>
                  {t('perf.resources.gcPause', { pause: formatUnit(r.gcPauseMsPerMin, 'ms/min'), max: formatUnit(r.gcMaxPauseMs, 'ms') })}
                </small>
              </span>
              {r.memoryTrend?.growing && (
                <span className="pf-resource-warn">
                  <TrendingUp size={13} />
                  {t('perf.resources.growth', { mb: r.memoryTrend.changeMb, minutes: r.memoryTrend.windowMin })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};
