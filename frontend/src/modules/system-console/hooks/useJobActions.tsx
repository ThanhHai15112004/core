import { useCallback, useState } from 'react';
import type { JobDetail, JobRow, JobsSettings } from '../types/jobs.types';
import { jobsApi } from '../services/jobs.api';
import { DbActionModal } from '../components/database/DbActionModal';
import { useConsoleData } from '../context/console-data-context';
import { formatMs, shortJobId } from '../utils/worker-format';
import { NO_VALUE } from '../utils/runtime-format';
import { useLocale } from '../../../core/i18n/index';

export type JobAction = 'retry' | 'cancel' | 'remove';

type Pending = { action: JobAction; job: JobRow; detail: JobDetail | null } | { action: 'bulk'; jobs: JobRow[] };

/**
 * Retry / Cancel / Remove một job và Retry nhiều job lỗi đã chọn — modal nói rõ điều gì sẽ xảy ra: retry lặp lại tác
 * dụng phụ nghiệp vụ (idempotency), huỷ job đang chạy chỉ là yêu cầu hợp tác, xoá bản ghi không hoàn tác nghiệp vụ.
 */
export function useJobActions(settings: JobsSettings | null | undefined, environment: string, onDone: (action: JobAction | 'bulk') => void) {
  const { t, formatRelative } = useLocale();
  const { addToast } = useConsoleData();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    setPending(null);
    setReason('');
  }, []);

  const run = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === 'bulk') {
        const r = await jobsApi.bulkRetry(pending.jobs.map((j) => ({ queue: j.queue, id: j.id })));
        const retried = r.items.filter((i) => i.result === 'retried').length;
        addToast({
          type: retried === r.items.length ? 'success' : 'warning',
          title: t('jobs.action.done.bulk', {
            count: retried,
            total: r.items.length,
          }),
          ...(retried < r.items.length
            ? {
                message: t('jobs.action.bulkSkipped', {
                  count: r.items.length - retried,
                }),
              }
            : {}),
        });
      } else {
        const { action, job } = pending;
        if (action === 'retry') await jobsApi.retry(job.id, job.queue);
        if (action === 'remove') await jobsApi.remove(job.id, job.queue);
        if (action === 'cancel') {
          const r = await jobsApi.cancel(job.id, job.queue, reason.trim() || undefined);
          addToast({
            type: r.mode === 'cooperative' && !r.delivered ? 'warning' : 'success',
            title: t(`jobs.action.done.cancel.${r.mode === 'removed' ? 'removed' : r.delivered ? 'requested' : 'notDelivered'}`, { id: shortJobId(job.id) }),
          });
        } else
          addToast({
            type: 'success',
            title: t(`jobs.action.done.${action}`, { id: shortJobId(job.id) }),
          });
      }
      onDone(pending.action);
      close();
    } catch (err) {
      addToast({
        type: 'error',
        title: t('jobs.action.failed'),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [addToast, close, onDone, pending, reason, t]);

  let modal: React.ReactNode = null;
  if (pending?.action === 'bulk') {
    const max = settings?.bulkRetryMax ?? 0;
    const over = pending.jobs.length > max;
    const byError = new Map<string, number>();
    for (const j of pending.jobs) byError.set(j.errorType ?? '—', (byError.get(j.errorType ?? '—') ?? 0) + 1);
    modal = (
      <DbActionModal
        title={t('jobs.modal.bulk.title', { count: pending.jobs.length })}
        context={[
          {
            label: t('jobs.modal.environment'),
            value: <strong>{environment.toUpperCase()}</strong>,
          },
          {
            label: t('jobs.modal.bulk.selected'),
            value: `${pending.jobs.length} / ${t('jobs.modal.bulk.max', { max })}`,
          },
          {
            label: t('jobs.modal.bulk.types'),
            value: [...new Set(pending.jobs.map((j) => j.type))].join(', '),
          },
          {
            label: t('jobs.modal.bulk.errors'),
            value: [...byError.entries()].map(([e, n]) => `${e} × ${n}`).join(', '),
          },
        ]}
        warning={over ? t('jobs.modal.bulk.tooMany', { max }) : t('jobs.modal.bulk.warning')}
        confirmLabel={t('jobs.modal.bulk.confirm', {
          count: pending.jobs.length,
        })}
        confirmDisabled={over || !settings?.retry}
        busy={busy}
        onCancel={close}
        onConfirm={() => void run()}
      >
        <ul className="job-bulk-preview">
          {pending.jobs.slice(0, 10).map((j) => (
            <li key={`${j.queue}|${j.id}`}>
              <code>#{shortJobId(j.id)}</code> {j.type} · <code>{j.errorType ?? '—'}</code> · {j.attempts}/{j.maxAttempts}
            </li>
          ))}
          {pending.jobs.length > 10 && <li className="ov-muted">{t('jobs.modal.bulk.more', { count: pending.jobs.length - 10 })}</li>}
        </ul>
      </DbActionModal>
    );
  } else if (pending) {
    const { action, job, detail } = pending;
    const now = Date.now();
    const idem = detail?.idempotency;
    const running = job.status === 'active' || job.status === 'stalled';
    const context = {
      retry: [
        {
          label: t('jobs.modal.previousAttempts'),
          value: String(job.attempts),
        },
        {
          label: t('jobs.modal.lastError'),
          value: job.errorType ? <code>{job.errorType}</code> : NO_VALUE,
        },
        {
          label: t('jobs.detail.idempotency'),
          value: idem ? `${t(`jobs.idempotency.${idem.protection}`)}${idem.key ? ` · ${idem.key}` : ''}` : NO_VALUE,
        },
      ],
      cancel: running
        ? [
            { label: t('jobs.modal.running'), value: formatMs(job.runningMs) },
            {
              label: t('jobs.modal.progress'),
              value: job.progress?.percent != null ? `${Math.round(job.progress.percent)}%` : t('jobs.modal.noProgress'),
            },
          ]
        : [
            {
              label: t('jobs.modal.state'),
              value: t(`jobs.status.${job.status}`),
            },
          ],
      remove: [
        { label: t('jobs.modal.state'), value: t(`jobs.status.${job.status}`) },
        {
          label: t('jobs.modal.finished'),
          value: job.finishedAt ? formatRelative(new Date(job.finishedAt), now) : NO_VALUE,
        },
      ],
    }[action];
    const warning =
      action === 'retry'
        ? idem?.protection === 'enabled'
          ? t('jobs.modal.retry.warning')
          : t('jobs.modal.retry.sideEffects')
        : action === 'cancel'
          ? running
            ? t('jobs.modal.cancel.cooperative')
            : t('jobs.modal.cancel.queued')
          : t('jobs.modal.remove.warning');
    modal = (
      <DbActionModal
        title={t(`jobs.modal.${action}.title${action === 'cancel' && running ? 'Running' : ''}`)}
        context={[
          {
            label: t('jobs.modal.environment'),
            value: <strong>{environment.toUpperCase()}</strong>,
          },
          { label: t('jobs.col.type'), value: <strong>{job.type}</strong> },
          { label: t('jobs.col.id'), value: <code>{job.id}</code> },
          { label: t('jobs.col.queue'), value: <code>{job.queue}</code> },
          ...context,
        ]}
        warning={warning}
        confirmLabel={t(`jobs.modal.${action}.confirm${action === 'cancel' && running ? 'Running' : ''}`)}
        {...(action === 'remove' ? { confirmWord: 'REMOVE' } : {})}
        busy={busy}
        onCancel={close}
        onConfirm={() => void run()}
      >
        {action === 'cancel' && (
          <label className="rt-modal-confirm">
            <span>{t('jobs.modal.cancel.reason')}</span>
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={t('jobs.modal.cancel.reasonPlaceholder')} />
          </label>
        )}
      </DbActionModal>
    );
  }

  return {
    modal,
    request: (action: JobAction, job: JobRow, detail: JobDetail | null = null) => setPending({ action, job, detail }),
    bulk: (jobs: JobRow[]) => setPending({ action: 'bulk', jobs }),
  };
}
