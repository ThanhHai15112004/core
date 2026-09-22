import React from 'react';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import type { TrafficInsights } from '../../types/traffic.types';
import { shortRoute } from '../../utils/traffic-format';
import { useLocale } from '../../../../core/i18n/index';

interface SecurityTrafficPanelProps {
  insights: TrafficInsights | null;
  onFilterStatus: (status: string) => void;
  onOpenSecurity: () => void;
}

/** 401/403/429 là tín hiệu cho Security; quản lý chặn/rate limit nằm ở trang Security. */
export const SecurityTrafficPanel: React.FC<SecurityTrafficPanelProps> = ({ insights, onFilterStatus, onOpenSecurity }) => {
  const { t } = useLocale();
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('tr.security.title')}</h3>
      </header>
      {!insights ? (
        <p className="ov-empty-line">{t('common.loading')}</p>
      ) : (
        <>
          <ul className="tr-rank-list">
            {insights.security.map((s) => (
              <li key={s.status}>
                <button type="button" onClick={() => onFilterStatus(String(s.status))} disabled={s.count === 0}>
                  <span>
                    <strong>{s.status}</strong> {t(`tr.security.status.${s.status}`)}
                    {s.topRoute && (
                      <small className="tr-muted"> · {s.topRoute.method} {shortRoute(s.topRoute.route)}</small>
                    )}
                  </span>
                  <span className={s.count > 0 ? 'tr-warn-text' : 'tr-muted'}>{s.count.toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="tr-note">
            <ShieldAlert size={15} />
            <div>
              <strong>{t('tr.security.rateLimit')}</strong>
              <p>{insights.rateLimit.message}</p>
            </div>
          </div>
          <button type="button" className="ov-link" onClick={onOpenSecurity}>
            {t('tr.security.open')} <ArrowRight size={13} />
          </button>
        </>
      )}
    </section>
  );
};
