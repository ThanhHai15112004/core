import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { JobProblem, JobsOverview } from '../../types/jobs.types';
import { useLocale } from '../../../../core/i18n/index';

/** Current Problems — mỗi dòng mở Explorer với đúng bộ lọc (hoặc job cụ thể). */
export const JobsProblems: React.FC<{
  data: JobsOverview | null;
  onOpen: (p: JobProblem) => void;
}> = ({ data, onOpen }) => {
  const { t } = useLocale();
  const problems = data?.problems ?? [];
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('jobs.problems.title')}</h3>
        {problems.length > 0 && <span className="ov-count">{problems.length}</span>}
      </header>
      {data && data.status !== 'unavailable' && problems.length === 0 && (
        <p className="msg-status-line ov-tone-ok">
          <CheckCircle2 size={14} /> <strong>{t('jobs.problems.allGood')}</strong>
        </p>
      )}
      {data?.status === 'unavailable' && <p className="msg-status-line ov-tone-crit">{t('jobs.problems.unavailable', { state: data.provider.connection })}</p>}
      <ul className="db-alerts">
        {problems.map((p) => (
          <li key={p.id} className={`ov-tone-${p.severity === 'critical' ? 'crit' : 'warn'}`}>
            <span className="ov-dot" aria-hidden="true" />
            <span className="db-alert-body">
              <strong>
                <span className="wq-sev">{t(`wq.severity.${p.severity}`)}</span> {p.message}
              </strong>
            </span>
            <button type="button" className="ov-link" onClick={() => onOpen(p)}>
              {t('db.alerts.inspect')} <ArrowRight size={12} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
