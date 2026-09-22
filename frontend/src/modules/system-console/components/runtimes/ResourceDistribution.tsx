import React from 'react';
import type { RuntimeSummary } from '../../types/runtime.types';
import { formatMb } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const COLORS = ['var(--scp-series-1)', 'var(--scp-series-2)', 'var(--scp-series-3)'];

/** Tỷ trọng bộ nhớ (RSS) của từng runtime trên tổng. */
export const ResourceDistribution: React.FC<{ runtimes: RuntimeSummary[] }> = ({ runtimes }) => {
  const { t } = useLocale();
  const withMem = runtimes.filter((r) => r.resources);
  const total = withMem.reduce((s, r) => s + r.resources!.rssMb, 0);

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('rt.distribution.title')}</h3>
        <span className="ov-section-hint">{formatMb(total)}</span>
      </header>
      {total === 0 ? (
        <p className="ov-empty-line">{t('rt.noTelemetry')}</p>
      ) : (
        <>
          <div className="rt-stack" aria-hidden="true">
            {withMem.map((r, i) => (
              <span key={r.id} style={{ width: `${(r.resources!.rssMb / total) * 100}%`, background: COLORS[i % COLORS.length] }} />
            ))}
          </div>
          <ul className="rt-dist-list">
            {withMem.map((r, i) => (
              <li key={r.id}>
                <i style={{ background: COLORS[i % COLORS.length] }} />
                <span>{r.name}</span>
                <strong>{Math.round((r.resources!.rssMb / total) * 100)}%</strong>
                <small>{formatMb(r.resources!.rssMb)}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
