import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import type { Attempt } from '../../types/jobs.types';
import { formatMs, instanceLabel } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const RESULT_TONE: Record<Attempt['result'], string> = {
  completed: 'ok',
  failed: 'crit',
  running: 'ok',
  cancelled: 'unknown',
  unknown: 'unknown',
};

/** Stack trace thu gọn mặc định (không chiếm cả màn hình) + Copy. */
export const StackTrace: React.FC<{ stack: string }> = ({ stack }) => {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <div className="job-stack">
      <div className="job-stack-head">
        <button type="button" className="ov-link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {open ? t('jobs.stack.hide') : t('jobs.stack.show')}
        </button>
        <button type="button" className="ov-link" onClick={() => void navigator.clipboard?.writeText(stack)}>
          <Copy size={12} /> {t('jobs.stack.copy')}
        </button>
      </div>
      {open && <pre className="job-pre">{stack}</pre>}
    </div>
  );
};

/** Attempts: bảng từng lần thử + Retry Timeline (backoff giữa các lần) + chi tiết lần thử khi bấm. */
export const JobAttempts: React.FC<{
  attempts: Attempt[];
  maxAttempts: number;
  exhausted: boolean;
}> = ({ attempts, maxAttempts, exhausted }) => {
  const { t, formatTime } = useLocale();
  const [open, setOpen] = useState<number | null>(null);
  if (!attempts.length) return <p className="ov-empty-line">{t('jobs.attempts.none')}</p>;
  return (
    <>
      <div className="scp-table-wrap">
        <table className="scp-table">
          <thead>
            <tr>
              <th>{t('jobs.attempts.col.attempt')}</th>
              <th>{t('jobs.attempts.col.result')}</th>
              <th>{t('jobs.attempts.col.duration')}</th>
              <th>{t('jobs.attempts.col.error')}</th>
              <th>{t('jobs.attempts.col.worker')}</th>
              <th>{t('jobs.attempts.col.started')}</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <React.Fragment key={a.attempt}>
                <tr className="is-clickable" onClick={() => setOpen((o) => (o === a.attempt ? null : a.attempt))}>
                  <td>
                    #{a.attempt}
                    {a.manual && <small className="pf-row-note">{t('jobs.attempts.manual')}</small>}
                  </td>
                  <td>
                    <span className={`pf-chip ov-tone-${RESULT_TONE[a.result]}`}>{t(`jobs.attempts.result.${a.result}`)}</span>
                  </td>
                  <td>{formatMs(a.durationMs)}</td>
                  <td>{a.errorType ? <code className="job-error">{a.errorType}</code> : NO_VALUE}</td>
                  <td>{a.instance ? instanceLabel(a.instance) : (a.runtime ?? NO_VALUE)}</td>
                  <td>{a.startedAt ? formatTime(Date.parse(a.startedAt), true) : NO_VALUE}</td>
                </tr>
                {open === a.attempt && (
                  <tr className="job-attempt-detail">
                    <td colSpan={6}>
                      <dl className="db-stat-grid db-stat-compact">
                        <div>
                          <dt>{t('jobs.attempts.col.worker')}</dt>
                          <dd>{a.instance ?? a.runtime ?? NO_VALUE}</dd>
                        </div>
                        <div>
                          <dt>{t('jobs.attempts.col.started')}</dt>
                          <dd>{a.startedAt ? new Date(a.startedAt).toLocaleString() : NO_VALUE}</dd>
                        </div>
                        <div>
                          <dt>{t('jobs.attempts.finished')}</dt>
                          <dd>{a.finishedAt ? new Date(a.finishedAt).toLocaleString() : NO_VALUE}</dd>
                        </div>
                        <div>
                          <dt>{t('jobs.failure.retryable')}</dt>
                          <dd>{a.result === 'failed' ? t(`jobs.retryable.${a.retryable === false ? 'no' : a.retryable ? 'yes' : 'unknown'}`) : NO_VALUE}</dd>
                        </div>
                      </dl>
                      {a.error && <p className="sch-error-message">{a.error}</p>}
                      {a.stack && <StackTrace stack={a.stack} />}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="job-subhead">{t('jobs.attempts.timeline')}</h4>
      <ol className="job-lifecycle job-retry-timeline">
        {attempts.map((a, i) => (
          <li key={a.attempt} className={`ov-tone-${RESULT_TONE[a.result]}`}>
            {i > 0 && (
              <span className="job-lifecycle-gap">
                ↓{' '}
                {attempts[i - 1]!.backoffMs !== null
                  ? t('jobs.attempts.backoff', {
                      value: formatMs(attempts[i - 1]!.backoffMs),
                    })
                  : a.manual
                    ? t('jobs.attempts.manual')
                    : ''}
              </span>
            )}
            <div className="job-lifecycle-step">
              <time>{a.startedAt ? formatTime(Date.parse(a.startedAt), true) : '—'}</time>
              <span className="ov-dot" aria-hidden="true" />
              <span className="job-lifecycle-body">
                <strong>{t('jobs.attempts.attemptN', { n: a.attempt })}</strong>
                <span>
                  {a.result === 'failed' ? '✕' : a.result === 'completed' ? '✓' : '●'} {a.errorType ?? t(`jobs.attempts.result.${a.result}`)}
                </span>
              </span>
            </div>
          </li>
        ))}
        {exhausted && (
          <li className="ov-tone-crit">
            <span className="job-lifecycle-gap">↓</span>
            <div className="job-lifecycle-step">
              <time />
              <span className="ov-dot" aria-hidden="true" />
              <strong>{t('jobs.attempts.exhausted', { max: Math.max(maxAttempts, attempts.length) })}</strong>
            </div>
          </li>
        )}
      </ol>
    </>
  );
};
