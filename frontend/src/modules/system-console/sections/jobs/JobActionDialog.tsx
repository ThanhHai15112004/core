import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLocale } from '@core/i18n/index';
import { useAppMutation } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Input } from '@core/ui/primitives';
import { ConfirmDialog, KeyValueGrid, type KeyValueItem } from '@core/ui/blocks';
import type { JobDetail, JobRow, JobsSettings } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { BULK_PREVIEW_LIMIT, CANCEL_REASON_MAX, REMOVE_CONFIRM_WORD } from '../../constants/jobs';
import { attemptsLabel, dateTime, jobShortId } from '../../utils/jobs-format';
import { jobsKeys } from './jobs-keys';

export type JobAction = 'retry' | 'cancel' | 'remove';
export type JobActionRequest = { action: JobAction; job: JobRow; detail: JobDetail | null } | { action: 'bulk'; jobs: JobRow[] };

const isRunning = (j: JobRow) => j.status === 'active' || j.status === 'stalled';

interface Props {
  request: JobActionRequest | null;
  onClose: () => void;
  settings: JobsSettings | null | undefined;
  environment: string | null | undefined;
  /** Sau khi thao tác thành công (vd. bỏ chọn, rời trang job đã xoá). */
  onDone?: (req: JobActionRequest) => void;
}

/**
 * Retry / Huỷ / Xoá bản ghi một job và Retry nhiều job lỗi — hộp xác nhận nói rõ điều gì sẽ xảy ra: retry lặp lại tác
 * dụng phụ nghiệp vụ (idempotency), huỷ job đang chạy chỉ là yêu cầu hợp tác, xoá bản ghi không hoàn tác nghiệp vụ.
 */
export function JobActionDialog({ request, onClose, settings, environment, onDone }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [request]);

  const run = useAppMutation({
    mutationFn: async (req: JobActionRequest) => {
      if (req.action === 'bulk') {
        const r = await jobsApi.bulkRetry(req.jobs.map((j) => ({ queue: j.queue, id: j.id })));
        const retried = r.items.filter((i) => i.result === 'retried').length;
        const message = t('jobs.action.done.bulk', { count: retried, total: r.items.length });
        if (retried < r.items.length) toast.warning(message, { description: t('jobs.action.bulkSkipped', { count: r.items.length - retried }) });
        else toast.success(message);
        return;
      }
      const { action, job } = req;
      const id = jobShortId(job.id);
      if (action === 'retry') {
        await jobsApi.retry(job.id, job.queue);
        toast.success(t('jobs.action.done.retry', { id }));
      } else if (action === 'remove') {
        await jobsApi.remove(job.id, job.queue);
        toast.success(t('jobs.action.done.remove', { id }));
      } else {
        const r = await jobsApi.cancel(job.id, job.queue, reason.trim() || undefined);
        const key = r.mode === 'removed' ? 'removed' : r.delivered ? 'requested' : 'notDelivered';
        if (key === 'notDelivered') toast.warning(t(`jobs.action.done.cancel.${key}`, { id }));
        else toast.success(t(`jobs.action.done.cancel.${key}`, { id }));
      }
    },
    invalidate: [jobsKeys.all],
    success: false,
    error: t('jobs.action.failed'),
    onSuccess: (_d, req) => {
      onDone?.(req);
      onClose();
    },
  });

  if (!request) return null;
  const env: KeyValueItem = { label: t('jobs.modal.environment'), value: environment ? environment.toUpperCase() : null };
  const common = { open: true, onOpenChange: (o: boolean) => !o && onClose(), loading: run.isPending, onConfirm: () => run.mutate(request) };

  if (request.action === 'bulk') {
    const max = settings?.bulkRetryMax ?? 0;
    const over = request.jobs.length > max;
    const byError = new Map<string, number>();
    for (const j of request.jobs) byError.set(j.errorType ?? NO_VALUE, (byError.get(j.errorType ?? NO_VALUE) ?? 0) + 1);
    return (
      <ConfirmDialog
        {...common}
        title={t('jobs.modal.bulk.title', { count: request.jobs.length })}
        impact={[over ? t('jobs.modal.bulk.tooMany', { max }) : t('jobs.modal.bulk.warning')]}
        confirmLabel={t('jobs.modal.bulk.confirm', { count: request.jobs.length })}
        confirmDisabled={over || !settings?.retry}
      >
        <KeyValueGrid
          items={[
            env,
            { label: t('jobs.modal.bulk.selected'), value: `${request.jobs.length} / ${t('jobs.modal.bulk.max', { max })}`, mono: true },
            { label: t('jobs.modal.bulk.types'), value: [...new Set(request.jobs.map((j) => j.type))].join(', ') },
            { label: t('jobs.modal.bulk.errors'), value: [...byError.entries()].map(([e, n]) => `${e} × ${n}`).join(', '), mono: true },
          ]}
        />
        <ul className="flex flex-col gap-1 rounded-md border border-border bg-panel-2 p-2 font-mono text-xs text-fg-2">
          {request.jobs.slice(0, BULK_PREVIEW_LIMIT).map((j) => (
            <li key={`${j.queue}|${j.id}`} className="truncate">
              #{jobShortId(j.id)} · {j.type} · {j.errorType ?? NO_VALUE} · {attemptsLabel(j)}
            </li>
          ))}
          {request.jobs.length > BULK_PREVIEW_LIMIT && <li className="text-faint">{t('jobs.modal.bulk.more', { count: request.jobs.length - BULK_PREVIEW_LIMIT })}</li>}
        </ul>
      </ConfirmDialog>
    );
  }

  const { action, job, detail } = request;
  const running = isRunning(job);
  const idem = detail?.idempotency;
  const base: KeyValueItem[] = [
    env,
    { label: t('jobs.col.type'), value: job.type },
    { label: t('jobs.col.id'), value: job.id, mono: true },
    { label: t('jobs.col.queue'), value: job.queue, mono: true },
  ];
  const extra: Record<JobAction, KeyValueItem[]> = {
    retry: [
      { label: t('jobs.modal.previousAttempts'), value: String(job.attempts), mono: true },
      { label: t('jobs.modal.lastError'), value: job.errorType, mono: true },
      { label: t('jobs.detail.idempotency'), value: idem ? `${t(`jobs.idempotency.${idem.protection}`)}${idem.key ? ` · ${idem.key}` : ''}` : null },
    ],
    cancel: running
      ? [
          { label: t('jobs.modal.running'), value: f.duration(job.runningMs), mono: true },
          { label: t('jobs.modal.progress'), value: job.progress?.percent != null ? f.percent(job.progress.percent, 0) : t('jobs.modal.noProgress') },
        ]
      : [{ label: t('jobs.modal.state'), value: t(`jobs.status.${job.status}`) }],
    remove: [
      { label: t('jobs.modal.state'), value: t(`jobs.status.${job.status}`) },
      { label: t('jobs.modal.finished'), value: dateTime(job.finishedAt) },
    ],
  };
  const impact =
    action === 'retry'
      ? idem?.protection === 'enabled'
        ? t('jobs.modal.retry.warning')
        : t('jobs.modal.retry.sideEffects')
      : action === 'cancel'
        ? running
          ? t('jobs.modal.cancel.cooperative')
          : t('jobs.modal.cancel.queued')
        : t('jobs.modal.remove.warning');
  const suffix = action === 'cancel' && running ? 'Running' : '';

  return (
    <ConfirmDialog
      {...common}
      title={t(`jobs.modal.${action}.title${suffix}`)}
      impact={[impact]}
      confirmLabel={t(`jobs.modal.${action}.confirm${suffix}`)}
      tone={action === 'retry' ? 'primary' : 'danger'}
      typeToConfirm={action === 'remove' ? REMOVE_CONFIRM_WORD : undefined}
    >
      <KeyValueGrid items={[...base, ...extra[action]]} />
      {action === 'cancel' && (
        <label className="flex flex-col gap-1.5 text-sm text-fg-2">
          {t('jobs.modal.cancel.reason')}
          <Input value={reason} maxLength={CANCEL_REASON_MAX} onChange={(e) => setReason(e.target.value)} placeholder={t('jobs.modal.cancel.reasonPlaceholder')} />
        </label>
      )}
    </ConfirmDialog>
  );
}
