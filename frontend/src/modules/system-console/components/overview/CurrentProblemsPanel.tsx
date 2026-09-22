import React from 'react';
import type { ConsoleSectionId, ActiveIncidentItem } from '../../types/console.types';
import { useLocale } from '../../../../core/i18n/index';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface CurrentProblemsPanelProps {
  incidents: ActiveIncidentItem[];
  onNavigate: (section: ConsoleSectionId) => void;
}

export const CurrentProblemsPanel: React.FC<CurrentProblemsPanelProps> = ({
  incidents,
  onNavigate,
}) => {
  const { t } = useLocale();

  return (
    <div className="problems-panel">
      <div className="problems-header">
        <h3 className="problems-title">
          <AlertTriangle size={17} style={{ color: 'var(--scp-warning)' }} />
          <span>{t('problems.title')}</span>
          {incidents.length > 0 && (
            <span
              className="code-badge"
              style={{
                backgroundColor: 'var(--scp-warning-bg)',
                color: 'var(--scp-warning-text)',
                border: '1px solid var(--scp-warning-border)',
                fontWeight: 700,
              }}
            >
              {incidents.length}
            </span>
          )}
        </h3>

        <button
          type="button"
          className="scp-btn scp-btn-sm scp-btn-ghost"
          onClick={() => onNavigate('logs')}
        >
          {t('timeline.filterAll')} logs →
        </button>
      </div>

      <div className="problems-list">
        {incidents.length === 0 ? (
          <div className="problems-empty">
            <div className="problems-empty-icon" aria-hidden="true">
              <CheckCircle2 size={32} style={{ color: 'var(--scp-success)' }} />
            </div>
            <h4 className="problems-empty-title">{t('overview.noActiveIncidents')}</h4>
            <p className="problems-empty-desc">
              {t('overview.systemsNominal')}
            </p>
          </div>
        ) : (
          incidents.map((inc) => (
            <div
              key={inc.id}
              className={`problem-card severity-${inc.severity}`}
            >
              <div className="problem-card-top">
                <span className={`problem-severity-tag sev-${inc.severity}`}>
                  {inc.severity}
                </span>
                <span className="problem-time">{inc.startedAgo}</span>
              </div>

              <h4 className="problem-title">{inc.title}</h4>
              <p className="problem-desc">{inc.description}</p>

              <button
                type="button"
                className="problem-action-btn"
                onClick={() => onNavigate(inc.targetSection)}
              >
                {inc.actionLabel} →
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
