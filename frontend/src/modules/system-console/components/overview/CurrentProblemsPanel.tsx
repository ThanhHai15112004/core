import React from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import type { ActiveIncidentItem, ConsolePath } from '../../types/console.types';
import { toneOf } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

interface CurrentProblemsPanelProps {
  incidents: ActiveIncidentItem[];
  now: number;
  onNavigate: (path: ConsolePath) => void;
}

/** Vùng ⑤: danh sách vấn đề cần xử lý — không bao giờ để trống. */
export const CurrentProblemsPanel: React.FC<CurrentProblemsPanelProps> = ({ incidents, now, onNavigate }) => {
  const { t, formatRelative } = useLocale();

  return (
    <section className="ov-card ov-section ov-problems" aria-labelledby="ov-problems-title">
      <header className="ov-section-head">
        <h3 id="ov-problems-title">
          {t('ov.problems.title')}
          {incidents.length > 0 && <span className="ov-count">{incidents.length}</span>}
        </h3>
      </header>

      {incidents.length === 0 ? (
        <div className="ov-problems-empty">
          <CheckCircle2 size={28} />
          <strong>{t('overview.noActiveIncidents')}</strong>
          <span>{t('overview.systemsNominal')}</span>
        </div>
      ) : (
        <ul className="ov-problems-list">
          {incidents.map((inc) => (
            <li key={inc.id} className={`ov-problem ov-tone-${toneOf(inc.severity)}`}>
              <span className="ov-problem-severity">{t(`console.status.${inc.severity}`)}</span>
              <strong className="ov-problem-title">{inc.title}</strong>
              <p className="ov-problem-desc">{inc.description}</p>
              <div className="ov-problem-foot">
                <span>
                  {inc.startedAt ? t('ov.health.startedAt', { ago: formatRelative(inc.startedAt, now) }) : inc.startedAgo}
                </span>
                {inc.actionLabel && (
                  <button type="button" className="ov-link" onClick={() => onNavigate(inc.targetSection)}>
                    {inc.actionLabel} <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
