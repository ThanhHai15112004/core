import React from 'react';
import type { Breakdown } from '../../types/performance.types';
import { formatUnit } from '../../utils/performance-format';
import { useLocale } from '../../../../core/i18n/index';

/**
 * Thời gian trung bình của một request (đã vào tới handler) chia theo giai đoạn thật của Fastify/Nest;
 * DB/cache lấy từ instrumentation trong cùng request. Không phải distributed tracing.
 */
export const LatencyBreakdown: React.FC<{ breakdown: Breakdown; dbActive: boolean }> = ({ breakdown, dbActive }) => {
  const { t } = useLocale();
  const max = Math.max(0, ...breakdown.phases.map((p) => p.avgMs));
  const top = breakdown.phases.reduce((a, b) => (b.avgMs > a.avgMs ? b : a), breakdown.phases[0]!);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('perf.breakdown.title')}</h3>
        <span className="ov-section-hint">
          {breakdown.avgTotalMs === null
            ? t('perf.breakdown.noData')
            : t('perf.breakdown.total', { total: formatUnit(breakdown.avgTotalMs, 'ms'), count: breakdown.requests })}
        </span>
      </header>
      {breakdown.avgTotalMs === null ? (
        <p className="ov-empty-line">{t('perf.breakdown.empty')}</p>
      ) : (
        <>
          <ul className="pf-waterfall">
            {breakdown.phases.map((p) => (
              <li key={p.phase} className={p.phase === top.phase && p.avgMs > 0 ? 'is-top' : ''}>
                <span className="pf-waterfall-label">{t(`perf.breakdown.phase.${p.phase}`)}</span>
                <span className="pf-waterfall-track">
                  <span style={{ width: `${max > 0 ? Math.max(1, (p.avgMs / max) * 100) : 0}%` }} />
                </span>
                <span className="pf-waterfall-value">
                  {formatUnit(p.avgMs, 'ms')} <small>{p.percent}%</small>
                </span>
              </li>
            ))}
          </ul>
          <p className="pf-chart-note">
            {top.avgMs > 0 && t('perf.breakdown.dominant', { phase: t(`perf.breakdown.phase.${top.phase}`), percent: top.percent })}{' '}
            {dbActive
              ? t('perf.breakdown.dbQueries', { count: breakdown.dbQueriesPerRequest ?? 0 })
              : t('perf.breakdown.dbInactive')}
          </p>
        </>
      )}
    </section>
  );
};
