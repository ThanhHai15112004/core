import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { Throughput } from '../../types/performance.types';
import { formatUnit } from '../../utils/performance-format';
import { useLocale } from '../../../../core/i18n/index';

/** Luồng công việc qua hệ thống — HTTP tăng mà worker không tăng theo thì queue sẽ dồn. */
export const ThroughputFlow: React.FC<{ throughput: Throughput }> = ({ throughput: tp }) => {
  const { t } = useLocale();
  const steps = [
    { key: 'http', value: formatUnit(tp.httpPerSec, '/s') },
    { key: 'db', value: formatUnit(tp.dbQueriesPerSec, '/s') },
    { key: 'cache', value: formatUnit(tp.cacheOpsPerSec, '/s') },
    { key: 'messages', value: formatUnit(tp.messagesPerMin, '/min') },
    { key: 'jobs', value: formatUnit(tp.jobsPerMin, '/min') },
  ];
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('perf.throughput.title')}</h3>
        <span className="ov-section-hint">
          {tp.queueWaiting === null ? t('perf.throughput.queueUnknown') : t('perf.throughput.queueWaiting', { count: Math.round(tp.queueWaiting) })}
        </span>
      </header>
      <ol className="pf-flow">
        {steps.map((s, i) => (
          <li key={s.key}>
            <span className="pf-flow-step">
              <small>{t(`perf.throughput.${s.key}`)}</small>
              <strong>{s.value}</strong>
            </span>
            {i < steps.length - 1 && <ArrowRight size={14} className="pf-flow-arrow" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </section>
  );
};
