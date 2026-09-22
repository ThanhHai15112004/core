import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { TrafficProblem } from '../../types/traffic.types';
import { useLocale } from '../../../../core/i18n/index';

interface TrafficProblemsProps {
  problems: TrafficProblem[] | null;
  now: number;
  onOpen: (problem: TrafficProblem) => void;
}

/** Spike traffic / lỗi / latency và endpoint có vấn đề — do backend phát hiện, không tự suy ở UI. */
/** Số vấn đề hiện sẵn; phần còn lại mở bằng "Xem thêm". */
const COLLAPSED_LIMIT = 5;

export const TrafficProblems: React.FC<TrafficProblemsProps> = ({ problems, now, onOpen }) => {
  const { t, formatRelative } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const visible = problems && !expanded ? problems.slice(0, COLLAPSED_LIMIT) : problems;
  const hidden = (problems?.length ?? 0) - (visible?.length ?? 0);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('tr.problems.title')}</h3>
        {problems && problems.length > 0 && <span className="ov-count">{problems.length}</span>}
      </header>
      {problems === null ? (
        <p className="ov-empty-line">{t('common.loading')}</p>
      ) : problems.length === 0 ? (
        <p className="tr-problems-ok">
          <CheckCircle2 size={16} /> {t('tr.problems.none')}
        </p>
      ) : (
        <ul className="tr-problem-list">
          {visible!.map((p, i) => (
            <li key={`${p.kind}-${p.routeId ?? i}`} className={`tr-problem ov-tone-${p.severity === 'critical' ? 'crit' : 'warn'}`}>
              {p.severity === 'critical' ? <XCircle size={16} /> : <AlertTriangle size={16} />}
              <div>
                <strong>{p.title}</strong>
                <p>{p.message}</p>
                {p.since && <small>{t('tr.problems.since', { time: formatRelative(p.since, now) })}</small>}
              </div>
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onOpen(p)}>
                {t('tr.problems.inspect')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(hidden > 0 || expanded) && problems && problems.length > COLLAPSED_LIMIT && (
        <footer className="ov-section-foot">
          <button type="button" className="ov-link" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('tr.problems.less') : t('tr.problems.more', { count: hidden })}
          </button>
        </footer>
      )}
    </section>
  );
};
