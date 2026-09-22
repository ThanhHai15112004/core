import React from 'react';
import type { ConsoleSectionId, OverallHealthReport } from '../../types/console.types';
import { UptimeCounter } from '../common/UptimeCounter';

import { useLocale } from '../../../../core/i18n/index';
import { CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';

interface OverallHealthBannerProps {
  healthReport: OverallHealthReport;
  onNavigate: (section: ConsoleSectionId) => void;
}

export const OverallHealthBanner: React.FC<OverallHealthBannerProps> = ({
  healthReport,
  onNavigate,
}) => {
  const { t } = useLocale();
  const {
    status,
    title,
    message,
    healthyServices,
    totalServices,
    uptimeSeconds,
    affectedServices,
    actionLabel,
    actionSection,
    startedAgo,
  } = healthReport;

  // title/message đã được dịch sẵn (backend theo Accept-Language, fallback theo t()).
  const displayTitle = title;
  const displayMessage = message;

  const getStatusIcon = () => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 size={24} />;
      case 'degraded':
        return <AlertTriangle size={24} />;
      case 'critical':
      case 'down':
        return <AlertCircle size={24} />;
    }
  };

  return (
    <section
      className={`overall-health-banner status-${status}`}
      aria-label={t('overview.title')}
    >
      <div className="overall-health-left">
        <div className="overall-health-icon-box" aria-hidden="true">
          {getStatusIcon()}
        </div>

        <div>
          <h2 className="overall-health-title">{displayTitle}</h2>
          <div className="overall-health-desc">
            <span>{displayMessage}</span>

            {affectedServices && affectedServices.length > 0 && (
              <span className="code-badge">
                {t('common.warning')}: {affectedServices.join(', ')}
              </span>
            )}

            {startedAgo && (
              <span>• {startedAgo}</span>
            )}
          </div>
        </div>
      </div>

      <div className="overall-health-right">
        {status === 'healthy' ? (
          <>
            <div className="overall-uptime-pill">
              {healthyServices} / {totalServices} {t('common.operational')}
            </div>
            <div className="overall-uptime-pill">
              {t('common.uptime')}: <UptimeCounter uptimeSeconds={uptimeSeconds} />
            </div>
          </>
        ) : (
          <>
            <div className="overall-uptime-pill">
              {healthyServices} / {totalServices} {t('common.operational')}
            </div>
            {actionLabel && actionSection && (
              <button
                type="button"
                className="scp-btn scp-btn-sm scp-btn-primary"
                onClick={() => onNavigate(actionSection)}
              >
                {actionLabel} →
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
};
