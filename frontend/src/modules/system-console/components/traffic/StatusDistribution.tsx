import React from 'react';
import type { StatusCount, TrafficSummary } from '../../types/traffic.types';
import { HttpStatusBadge } from './TrafficBadges';
import { SERIES_COLORS } from '../../constants/traffic';
import { formatPct } from '../../utils/traffic-format';
import { useLocale } from '../../../../core/i18n/index';

interface StatusDistributionProps {
  summary: TrafficSummary | null;
  /** Bấm vào class/status → lọc danh sách request. */
  onSelect: (status: string) => void;
  topStatuses?: StatusCount[];
}

export const StatusDistribution: React.FC<StatusDistributionProps> = ({ summary, onSelect, topStatuses }) => {
  const { t } = useLocale();
  const statuses = topStatuses ?? summary?.topStatuses ?? [];

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('tr.status.title')}</h3>
      </header>
      {!summary || summary.stats.requests === 0 ? (
        <p className="ov-empty-line">{t('tr.status.empty')}</p>
      ) : (
        <>
          <ul className="tr-class-list">
            {summary.statusClasses.map((c) => (
              <li key={c.class}>
                <button type="button" className="tr-class-row" onClick={() => onSelect(c.class)} disabled={c.count === 0}>
                  <span className="tr-class-name">{c.class}</span>
                  <span className="tr-bar">
                    <span style={{ width: `${c.percent}%`, background: SERIES_COLORS[c.class] }} />
                  </span>
                  <span className="tr-class-value">{formatPct(c.percent, 1)}</span>
                </button>
              </li>
            ))}
          </ul>
          <h4 className="tr-subtitle">{t('tr.status.top')}</h4>
          <ul className="tr-status-list">
            {statuses.map((s) => (
              <li key={s.status}>
                <button type="button" onClick={() => onSelect(String(s.status))}>
                  <HttpStatusBadge status={s.status} />
                  <span>{s.count.toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
