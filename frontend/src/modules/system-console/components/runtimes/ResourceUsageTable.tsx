import React from 'react';
import type { RuntimeSummary } from '../../types/runtime.types';
import { formatMb, NO_VALUE, percent } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface ResourceUsageTableProps {
  runtimes: RuntimeSummary[];
  thresholds: { memoryPercent: number; cpuPercent: number } | null;
}

const Bar: React.FC<{ value: number | null; threshold: number | null }> = ({ value, threshold }) => {
  if (value === null) return <span className="rt-bar is-empty" />;
  const high = threshold !== null && value >= threshold;
  return (
    <span className={`rt-bar ${high ? 'is-high' : ''}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
};

/** CPU/RAM từng runtime với thanh tiến trình; đổi màu khi vượt ngưỡng. */
export const ResourceUsageTable: React.FC<ResourceUsageTableProps> = ({ runtimes, thresholds }) => {
  const { t } = useLocale();

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('rt.resources.title')}</h3>
        <span className="ov-section-hint">{t('rt.resources.hint')}</span>
      </header>
      <div className="rt-resource-rows">
        {runtimes.map((rt) => {
          const r = rt.resources;
          const memHigh = r?.memoryPercent !== null && r?.memoryPercent !== undefined && thresholds !== null && r.memoryPercent >= thresholds.memoryPercent;
          return (
            <div key={rt.id} className="rt-resource-row">
              <strong>{rt.name}</strong>
              <div>
                <span className="rt-resource-label">
                  {t('rt.metric.cpu')} <b>{r ? percent(r.cpuPercent) : NO_VALUE}</b>
                </span>
                <Bar value={r?.cpuPercent ?? null} threshold={thresholds?.cpuPercent ?? null} />
              </div>
              <div>
                <span className="rt-resource-label">
                  {t('rt.metric.memory')}{' '}
                  <b>
                    {r ? `${formatMb(r.memoryLimitSource === 'cgroup' ? r.rssMb : r.heapUsedMb)} / ${formatMb(r.memoryLimitMb)}` : NO_VALUE}
                  </b>
                  {r && <small>{t(`rt.memorySource.${r.memoryLimitSource}`)}</small>}
                </span>
                <Bar value={r?.memoryPercent ?? null} threshold={thresholds?.memoryPercent ?? null} />
                {memHigh && <span className="rt-resource-warn">{t('rt.resources.highMemory')}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
