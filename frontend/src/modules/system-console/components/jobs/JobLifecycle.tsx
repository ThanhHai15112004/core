import React from 'react';
import type { LifecycleStep } from '../../types/jobs.types';
import { formatMs } from '../../utils/worker-format';
import { instanceLabel } from '../../utils/worker-format';
import { useLocale } from '../../../../core/i18n/index';

const TONE: Partial<Record<LifecycleStep['kind'], string>> = {
  completed: 'ok',
  failed: 'crit',
  exhausted: 'crit',
  retry_scheduled: 'warn',
  stalled: 'warn',
  cancel_requested: 'warn',
  cancelled: 'unknown',
  running: 'ok',
};

const ms = (at: string | null) => (at ? Date.parse(at) : null);

/**
 * Job Lifecycle: Created → Enqueued → Picked by worker → Processing → Failed / Retry / Completed, với khoảng thời gian
 * giữa các bước (chờ trong queue, xử lý, backoff) — trực quan hơn dump metadata.
 */
export const JobLifecycle: React.FC<{
  steps: LifecycleStep[];
  available: boolean;
}> = ({ steps, available }) => {
  const { t, formatTime } = useLocale();
  const precise = (at: string | null) => {
    if (!at) return '—';
    const d = new Date(at);
    return `${formatTime(d, true)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  };
  const label = (s: LifecycleStep) => {
    const who = s.instance ? instanceLabel(s.instance) : s.runtime;
    switch (s.kind) {
      case 'enqueued':
        return t('jobs.lifecycle.enqueued', { queue: s.queue ?? '' });
      case 'picked':
        return who
          ? t('jobs.lifecycle.pickedBy', {
              worker: who,
              attempt: s.attempt ?? 1,
            })
          : t('jobs.lifecycle.picked', { attempt: s.attempt ?? 1 });
      case 'scheduled':
        return s.current ? t('jobs.lifecycle.runsAt') : t('jobs.lifecycle.scheduled', { delay: formatMs(s.delayMs) });
      case 'retry_scheduled':
        return t('jobs.lifecycle.retryScheduled', {
          attempt: (s.attempt ?? 0) + 1,
          delay: formatMs(s.delayMs),
        });
      case 'retried_manually':
        return s.actor ? t('jobs.lifecycle.retriedBy', { actor: s.actor }) : t('jobs.lifecycle.retried_manually');
      default:
        return t(`jobs.lifecycle.${s.kind}`);
    }
  };
  return (
    <>
      {!available && <p className="ov-muted job-note">{t('jobs.lifecycle.partial')}</p>}
      <ol className="job-lifecycle">
        {steps.map((s, i) => {
          const prev = i > 0 ? ms(steps[i - 1]!.at) : null;
          const cur = ms(s.at);
          const gap = prev !== null && cur !== null && !s.current ? cur - prev : null;
          return (
            <li key={`${s.kind}-${i}`} className={`ov-tone-${TONE[s.kind] ?? 'unknown'} ${s.current ? 'is-current' : ''}`}>
              {i > 0 && (
                <span className="job-lifecycle-gap">↓ {gap !== null && gap > 0 ? formatMs(gap) : ''}</span>
              )}
              <div className="job-lifecycle-step">
                <time>{s.current && s.kind !== 'scheduled' ? t('jobs.lifecycle.now') : precise(s.at)}</time>
                <span className="ov-dot" aria-hidden="true" />
                <span className="job-lifecycle-body">
                  <strong>{label(s)}</strong>
                  {s.errorType && <code className="job-error">{s.errorType}</code>}
                  {s.error && !s.errorType && <span className="ov-muted">{s.error}</span>}
                  {s.kind === 'cancelled' && s.actor && <span className="ov-muted">{t('jobs.lifecycle.by', { actor: s.actor })}</span>}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
};
