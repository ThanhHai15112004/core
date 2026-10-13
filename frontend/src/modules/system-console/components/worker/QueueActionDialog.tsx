import { useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Switch } from '@core/ui/primitives';
import { ConfirmDialog, KeyValueGrid, type KeyValueItem } from '@core/ui/blocks';
import type { QueueRetryResult, QueueRow, WorkerSettings } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { DRAIN_CONFIRM } from '../../constants/worker';
import { workerKeys } from '../../sections/worker/worker-keys';

export type QueueAction = 'pause' | 'resume' | 'retry' | 'drain';
export type QueueTarget = Pick<QueueRow, 'name' | 'waiting' | 'active' | 'delayed' | 'failed' | 'paused'>;
export interface QueueActionRequest {
  action: QueueAction;
  target: QueueTarget;
}

interface Props {
  request: QueueActionRequest | null;
  settings: WorkerSettings | null | undefined;
  onClose: () => void;
}

/**
 * Pause / Resume, Retry job lỗi (giới hạn mỗi lần theo `retryFailedMax`), Drain (gõ DRAIN, tuỳ chọn xoá cả job hẹn giờ).
 * Xong → toast + tải lại mọi query của trang.
 */
export function QueueActionDialog({ request, settings, onClose }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const [includeDelayed, setIncludeDelayed] = useState(false);
  const max = settings?.retryFailedMax ?? null;
  const retryCount = (target: QueueTarget) => Math.min(target.failed, max ?? target.failed);

  const mutation = useAppMutation({
    mutationFn: async (req: QueueActionRequest): Promise<QueueRetryResult | null> => {
      const name = req.target.name;
      if (req.action === 'pause') await workerApi.pause(name);
      else if (req.action === 'resume') await workerApi.resume(name);
      else if (req.action === 'drain') await workerApi.drain(name, includeDelayed);
      else return workerApi.retryFailed(name, retryCount(req.target));
      return null;
    },
    invalidate: [workerKeys.all],
    error: t('wq.action.failed'),
    success: (res, req) =>
      req.action === 'retry' && res
        ? t('wq.action.done.retry', { count: res.retried, requested: res.requested, queue: req.target.name })
        : t(`wq.action.done.${req.action}`, { queue: req.target.name }),
    onSuccess: () => close(),
  });

  const close = () => {
    setIncludeDelayed(false);
    onClose();
  };

  if (!request) return null;
  const { action, target } = request;
  const count = retryCount(target);
  const queueItem: KeyValueItem = { label: t('wq.queue.name'), value: target.name, mono: true };
  const items: Record<QueueAction, KeyValueItem[]> = {
    pause: [queueItem, { label: t('wq.queue.waiting'), value: f.compact(target.waiting) }, { label: t('wq.queue.active'), value: f.compact(target.active) }],
    resume: [queueItem, { label: t('wq.queue.waiting'), value: f.compact(target.waiting) }],
    retry: [queueItem, { label: t('wq.queue.failed'), value: f.compact(target.failed) }, { label: t('wq.modal.retry.batch'), value: f.compact(count) }],
    drain: [queueItem, { label: t('wq.queue.waiting'), value: f.compact(target.waiting) }, { label: t('wq.queue.delayed'), value: f.compact(target.delayed) }],
  };
  const impact: Record<QueueAction, string[]> = {
    pause: [t('wq.modal.pause.graceful')],
    resume: [],
    retry: target.failed > count ? [t('wq.modal.retry.batchNote', { max: f.compact(count), total: f.compact(target.failed) })] : [],
    drain: [t('wq.modal.drain.warning')],
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && close()}
      title={t(`wq.modal.${action}.title`, { queue: target.name })}
      description={action === 'drain' ? undefined : t(`wq.modal.${action}.warning`, { waiting: f.compact(target.waiting) })}
      impact={impact[action]}
      confirmLabel={action === 'retry' ? t('wq.modal.retry.confirm', { count: f.compact(count) }) : t(`wq.modal.${action}.confirm`)}
      tone={action === 'drain' ? 'danger' : 'primary'}
      typeToConfirm={action === 'drain' ? DRAIN_CONFIRM : undefined}
      loading={mutation.isPending}
      onConfirm={() => mutation.mutate(request)}
    >
      <KeyValueGrid items={items[action]} columns={action === 'resume' ? 2 : 3} />
      {action === 'drain' && (
        <label className="flex items-center gap-2 text-sm text-fg-2">
          <Switch checked={includeDelayed} onCheckedChange={setIncludeDelayed} />
          {t('wq.modal.drain.includeDelayed')}
        </label>
      )}
    </ConfirmDialog>
  );
}
