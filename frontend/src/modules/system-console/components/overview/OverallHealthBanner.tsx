import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ArrowRight } from 'lucide-react';
import type { ConsolePath, OverallHealthReport } from '../../types/console.types';
import { UptimeCounter } from '../common/UptimeCounter';
import { StatusPill } from '../common/StatusPill';
import { toneOf } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

interface OverallHealthBannerProps {
  healthReport: OverallHealthReport;
  now: number;
  onNavigate: (path: ConsolePath) => void;
}

const ICONS = { ok: CheckCircle2, warn: AlertTriangle, crit: XCircle, unknown: AlertTriangle } as const;

/** Vùng ①: trả lời "hệ thống có ổn không, cái gì hỏng, nên làm gì tiếp". */
export const OverallHealthBanner: React.FC<OverallHealthBannerProps> = ({ healthReport, now, onNavigate }) => {
  const { t, formatRelative } = useLocale();
  const { status, title, message, healthyServices, totalServices, uptimeSeconds, affectedComponents, actionLabel, actionSection, startedAt } =
    healthReport;
  const tone = toneOf(status);
  const Icon = ICONS[tone];

  return (
    <section className={`ov-health ov-tone-${tone}`} aria-live="polite">
      <div className="ov-health-main">
        <span className="ov-health-icon" aria-hidden="true">
          <Icon size={26} />
        </span>
        <div className="ov-health-text">
          <h2 className="ov-health-title">{title}</h2>
          <p className="ov-health-message">{message}</p>

          {affectedComponents && affectedComponents.length > 0 && (
            <ul className="ov-health-affected">
              {affectedComponents.map((c) => (
                <li key={c.name}>
                  <button type="button" className="ov-link-chip" onClick={() => onNavigate(c.section)}>
                    <span>{c.name}</span>
                    <StatusPill status={c.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {startedAt && (
            <p className="ov-health-meta">{t('ov.health.startedAt', { ago: formatRelative(startedAt, now) })}</p>
          )}
        </div>
      </div>

      <div className="ov-health-side">
        <div className="ov-health-stat">
          <span className="ov-health-stat-value">
            {healthyServices}/{totalServices}
          </span>
          <span className="ov-health-stat-label">{t('ov.health.servicesHealthy')}</span>
        </div>
        {uptimeSeconds > 0 && (
          <div className="ov-health-stat">
            <span className="ov-health-stat-value">
              <UptimeCounter uptimeSeconds={uptimeSeconds} />
            </span>
            <span className="ov-health-stat-label">{t('common.uptime')}</span>
          </div>
        )}
        {actionLabel && actionSection && (
          <button type="button" className="scp-btn scp-btn-primary ov-health-action" onClick={() => onNavigate(actionSection)}>
            <span>{actionLabel}</span>
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </section>
  );
};
