import { useCallback, useState } from 'react';
import type { QueueRow, WorkerSettings } from '../types/worker.types';
import { workerApi } from '../services/worker.api';
import { DRAIN_CONFIRM } from '../constants/worker';
import { DbActionModal } from '../components/database/DbActionModal';
import { useConsoleData } from '../context/console-data-context';
import { formatCompact } from '../utils/database-format';
import { useLocale } from '../../../core/i18n/index';

export type QueueAction = 'pause' | 'resume' | 'retry' | 'drain';
export type QueueTarget = Pick<QueueRow, 'name' | 'waiting' | 'active' | 'delayed' | 'failed' | 'paused'>;

/**
 * Pause / Resume queue, Retry job lỗi (có giới hạn mỗi lần, xem trước ở tab Failures), Drain (gõ DRAIN) —
 * modal nói rõ điều gì xảy ra + toast; `onDone` để tải lại.
 */
export function useQueueActions(settings: WorkerSettings | null | undefined, onDone: (action: QueueAction, queue: string) => void) {
  const { t, locale } = useLocale();
  const { addToast } = useConsoleData();
  const [pending, setPending] = useState<{ action: QueueAction; target: QueueTarget } | null>(null);
  const [busy, setBusy] = useState(false);
  const [includeDelayed, setIncludeDelayed] = useState(false);
  const n = (v: number) => formatCompact(v, locale);

  const max = settings?.retryFailedMax ?? null;
  const retryCount = useCallback((target: QueueTarget) => Math.min(target.failed, max ?? target.failed), [max]);

  const run = useCallback(async () => {
    if (!pending) return;
    const { action, target } = pending;
    setBusy(true);
    try {
      if (action === 'pause') await workerApi.pause(target.name);
      else if (action === 'resume') await workerApi.resume(target.name);
      else if (action === 'drain') await workerApi.drain(target.name, includeDelayed);
      else {
        const r = await workerApi.retryFailed(target.name, retryCount(target));
        addToast({ type: 'success', title: t('wq.action.done.retry', { count: r.retried, requested: r.requested, queue: target.name }) });
      }
      if (action !== 'retry') addToast({ type: 'success', title: t(`wq.action.done.${action}`, { queue: target.name }) });
      setPending(null);
      onDone(action, target.name);
    } catch (err) {
      addToast({ type: 'error', title: t('wq.action.failed'), message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [addToast, includeDelayed, onDone, pending, retryCount, t]);

  let modal: React.ReactNode = null;
  if (pending) {
    const { action, target } = pending;
    const count = retryCount(target);
    const context = {
      pause: [
        { label: t('wq.queue.active'), value: n(target.active) },
        { label: t('wq.queue.waiting'), value: n(target.waiting) },
        { label: t('wq.modal.pause.mode'), value: t('wq.modal.pause.graceful') },
      ],
      resume: [{ label: t('wq.queue.waiting'), value: n(target.waiting) }],
      retry: [
        { label: t('wq.queue.failed'), value: n(target.failed) },
        { label: t('wq.modal.retry.batch'), value: n(count) },
      ],
      drain: [
        { label: t('wq.queue.waiting'), value: n(target.waiting) },
        { label: t('wq.queue.delayed'), value: n(target.delayed) },
        {
          label: t('wq.modal.drain.delayed'),
          value: (
            <label className="wq-check">
              <input type="checkbox" checked={includeDelayed} onChange={(e) => setIncludeDelayed(e.target.checked)} />
              {t('wq.modal.drain.includeDelayed')}
            </label>
          ),
        },
      ],
    }[action];
    modal = (
      <DbActionModal
        title={t(`wq.modal.${action}.title`, { queue: target.name })}
        context={[{ label: t('wq.queue.name'), value: <code>{target.name}</code> }, ...context]}
        warning={
          action === 'retry' && target.failed > count
            ? `${t('wq.modal.retry.warning')} ${t('wq.modal.retry.batchNote', { max: n(count), total: n(target.failed) })}`
            : t(`wq.modal.${action}.warning`, { waiting: n(target.waiting) })
        }
        confirmLabel={action === 'retry' ? t('wq.modal.retry.confirm', { count: n(count) }) : t(`wq.modal.${action}.confirm`)}
        {...(action === 'drain' ? { confirmWord: DRAIN_CONFIRM } : {})}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void run()}
      />
    );
  }

  return {
    modal,
    request: (action: QueueAction, target: QueueTarget) => {
      setIncludeDelayed(false);
      setPending({ action, target });
    },
  };
}
