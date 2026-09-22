import React from 'react';
import type { ErrorAnalysis } from '../../types/traffic.types';
import { formatPct, shortRoute } from '../../utils/traffic-format';
import { HttpStatusBadge, MethodBadge } from './TrafficBadges';
import { useLocale } from '../../../../core/i18n/index';

interface ErrorAnalysisPanelProps {
  data: ErrorAnalysis | null;
  onOpenRoute: (routeId: string) => void;
  onSelectStatus: (status: string) => void;
}

/** Tổng lỗi, top endpoint lỗi, top mã lỗi (code của exception filter). */
export const ErrorAnalysisPanel: React.FC<ErrorAnalysisPanelProps> = ({ data, onOpenRoute, onSelectStatus }) => {
  const { t } = useLocale();
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('tr.errors.title')}</h3>
      </header>
      {!data ? (
        <p className="ov-empty-line">{t('common.loading')}</p>
      ) : (
        <div className="tr-error-grid">
          <dl className="tr-error-totals">
            <div>
              <dt>{t('tr.errors.rate')}</dt>
              <dd>{formatPct(data.stats.errorRatePercent)}</dd>
            </div>
            <div>
              <dt>4xx</dt>
              <dd>{data.stats.clientErrors.toLocaleString()}</dd>
            </div>
            <div>
              <dt>5xx</dt>
              <dd className={data.stats.serverErrors > 0 ? 'tr-bad' : ''}>{data.stats.serverErrors.toLocaleString()}</dd>
            </div>
          </dl>
          <div>
            <h4 className="tr-subtitle">{t('tr.errors.topRoutes')}</h4>
            {data.topRoutes.length === 0 ? (
              <p className="ov-empty-line">{t('tr.errors.none')}</p>
            ) : (
              <ul className="tr-rank-list">
                {data.topRoutes.map((r) => (
                  <li key={r.routeId}>
                    <button type="button" onClick={() => onOpenRoute(r.routeId)}>
                      <span className="tr-endpoint">
                        <MethodBadge method={r.method} />
                        <code>{shortRoute(r.route)}</code>
                      </span>
                      <span className="tr-rank-values">
                        <span className="tr-warn-text">{r.clientErrors} × 4xx</span>
                        <span className="tr-bad">{r.serverErrors} × 5xx</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="tr-subtitle">{t('tr.errors.topCodes')}</h4>
            {data.topCodes.length === 0 ? (
              <p className="ov-empty-line">{t('tr.errors.none')}</p>
            ) : (
              <ul className="tr-rank-list">
                {data.topCodes.map((c) => (
                  <li key={c.code} className="tr-rank-static">
                    <code>{c.code}</code>
                    <span>{c.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
            {data.topStatuses.length > 0 && (
              <ul className="tr-status-list">
                {data.topStatuses.map((s) => (
                  <li key={s.status}>
                    <button type="button" onClick={() => onSelectStatus(String(s.status))}>
                      <HttpStatusBadge status={s.status} />
                      <span>{s.count.toLocaleString()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
