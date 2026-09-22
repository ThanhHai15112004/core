import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { Bottleneck } from '../../types/performance.types';
import { formatUnit } from '../../utils/performance-format';
import { shortRoute } from '../../utils/traffic-format';
import { useLocale } from '../../../../core/i18n/index';

interface BottleneckListProps {
  bottlenecks: Bottleneck[];
  windowMin: number;
  now: number;
  onInspect: (target: string) => void;
}

/** Điểm nghẽn đang có (rule theo ngưỡng): giá trị hiện tại, nền, bắt đầu từ lúc nào, endpoint bị ảnh hưởng. */
export const BottleneckList: React.FC<BottleneckListProps> = ({ bottlenecks, windowMin, now, onInspect }) => {
  const { t, formatRelative } = useLocale();
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('perf.bottlenecks.title')}</h3>
        {bottlenecks.length > 0 && <span className="ov-count">{bottlenecks.length}</span>}
      </header>
      {bottlenecks.length === 0 ? (
        <p className="pf-ok-line">
          <CheckCircle2 size={16} /> {t('perf.bottlenecks.none', { minutes: windowMin })}
        </p>
      ) : (
        <ul className="pf-bottlenecks">
          {bottlenecks.map((b) => (
            <li key={b.id} className={`pf-bottleneck ov-tone-${b.severity === 'critical' ? 'crit' : 'warn'}`}>
              <div className="pf-bottleneck-head">
                <span className="pf-severity">{t(`perf.severity.${b.severity}`)}</span>
                <strong>{b.title}</strong>
              </div>
              <p>{b.message}</p>
              <dl className="pf-bottleneck-stats">
                <div>
                  <dt>{t('perf.bottlenecks.current')}</dt>
                  <dd>{formatUnit(b.value, b.unit)}</dd>
                </div>
                <div>
                  <dt>{t('perf.bottlenecks.baseline')}</dt>
                  <dd>{formatUnit(b.baseline, b.unit)}</dd>
                </div>
                <div>
                  <dt>{t('perf.bottlenecks.threshold')}</dt>
                  <dd>{formatUnit(b.threshold, b.unit)}</dd>
                </div>
                <div>
                  <dt>{t('perf.bottlenecks.since')}</dt>
                  <dd>{b.since ? formatRelative(new Date(b.since), now) : t('perf.bottlenecks.sinceUnknown')}</dd>
                </div>
              </dl>
              {b.impact.length > 0 && (
                <p className="pf-impact">
                  {t(b.rule === 'DB_LATENCY' ? 'perf.bottlenecks.impactDb' : 'perf.bottlenecks.impact')}{' '}
                  {b.impact.map((i) => `${i.method} ${shortRoute(i.route)} (${formatUnit(i.valueMs, 'ms')})`).join(', ')}
                </p>
              )}
              <button type="button" className="ov-link" onClick={() => onInspect(b.target)}>
                {t(`perf.bottlenecks.inspect.${b.component}`)} <ArrowRight size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
