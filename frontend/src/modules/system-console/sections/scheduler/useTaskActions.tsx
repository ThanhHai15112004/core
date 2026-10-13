import { useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation, useLiveQuery } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { ConfirmDialog, KeyValueGrid, type KeyValueItem } from '@core/ui/blocks';
import type { SchedulerSettings, TaskRow } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { formatDateTime, formatIn, secondsUntil } from '../../utils/scheduler-format';
import { schedulerKeys } from './scheduler-keys';

export type TaskAction = 'run' | 'enable' | 'disable';

interface Pending {
  action: TaskAction;
  task: TaskRow;
}

/**
 * Run Now / Bật / Tắt task: hộp xác nhận nói rõ điều gì xảy ra (môi trường, lần chạy gần nhất, trạng thái, lịch kế
 * tiếp) → toast → tải lại dữ liệu Scheduler. Run Now xong mở luôn lần chạy vừa tạo.
 */
export function useTaskActions({ settings, environment, onRun }: { settings: SchedulerSettings | undefined; environment: string; onRun: (executionId: string) => void }) {
  const { t, locale, formatRelative } = useLocale();
  const [pending, setPending] = useState<Pending | null>(null);

  const run = useAppMutation({
    mutationFn: (task: TaskRow) => schedulerApi.run(task.id),
    invalidate: [schedulerKeys.all],
    success: (_r, task) => t('sch.action.done.run', { task: task.name }),
    error: t('sch.action.failed'),
    onSuccess: (r) => {
      setPending(null);
      onRun(r.executionId);
    },
  });
  const toggle = useAppMutation({
    mutationFn: ({ task, enable }: { task: TaskRow; enable: boolean }) => (enable ? schedulerApi.enable(task.id) : schedulerApi.disable(task.id)),
    invalidate: [schedulerKeys.all],
    success: (_r, v) => t(`sch.action.done.${v.enable ? 'enable' : 'disable'}`, { task: v.task.name }),
    error: t('sch.action.failed'),
    onSuccess: () => setPending(null),
  });

  /** Task đang tắt thì backend không lên lịch → tính lần chạy kế tiếp theo lịch nếu bật lại. */
  const enabling = pending?.action === 'enable' ? pending.task.schedule : null;
  const cron = useLiveQuery(schedulerKeys.cron(enabling?.expression ?? '', enabling?.timezone ?? ''), () => schedulerApi.cron(enabling!.expression!, enabling!.timezone), {
    tier: 'static',
    enabled: Boolean(enabling?.expression),
    keepPrevious: false,
  });

  let dialog: React.ReactNode = null;
  if (pending) {
    const { action, task } = pending;
    const now = Date.now();
    const at = (iso: string | null | undefined) => (iso ? `${formatDateTime(iso, locale, false)} (${formatIn(secondsUntil(iso, now))})` : NO_VALUE);
    const state = task.running > 0 ? t('sch.modal.running', { count: task.running }) : t('sch.modal.idle');
    const nextAfterEnable =
      task.schedule.type === 'interval' && task.schedule.intervalMs
        ? new Date(Math.ceil((now + 1) / task.schedule.intervalMs) * task.schedule.intervalMs).toISOString()
        : (cron.data?.next[0] ?? null);
    const context: Record<TaskAction, KeyValueItem[]> = {
      run: [
        { label: t('sch.modal.environment'), value: <span className="font-semibold uppercase">{environment || NO_VALUE}</span> },
        {
          label: t('sch.modal.lastRun'),
          value: task.lastRunAt ? `${task.lastStatus ? `${t(`sch.exec.status.${task.lastStatus}`)} · ` : ''}${formatRelative(task.lastRunAt, now)}` : t('sch.task.never'),
        },
        { label: t('sch.modal.state'), value: state },
      ],
      disable: [
        { label: t('sch.modal.nextScheduled'), value: at(task.nextRunAt) },
        { label: t('sch.modal.state'), value: state },
      ],
      enable: [{ label: t('sch.modal.nextAfterEnable'), value: at(nextAfterEnable) }],
    };
    const busy = run.isPending || toggle.isPending;
    dialog = (
      <ConfirmDialog
        open
        onOpenChange={(o) => !o && !busy && setPending(null)}
        title={t(`sch.modal.${action}.title`, { task: task.name })}
        description={action === 'disable' ? undefined : t(`sch.modal.${action}.warning`)}
        impact={action === 'disable' ? [t('sch.modal.disable.warning')] : undefined}
        tone={action === 'disable' ? 'danger' : 'primary'}
        confirmLabel={t(`sch.modal.${action}.confirm`)}
        loading={busy}
        onConfirm={() => (action === 'run' ? run.mutate(task) : toggle.mutate({ task, enable: action === 'enable' }))}
      >
        <KeyValueGrid
          items={[
            { label: t('sch.task.name'), value: task.name },
            { label: t('sch.task.schedule'), value: `${task.schedule.description} · ${task.schedule.timezone}` },
            ...context[action],
          ]}
        />
      </ConfirmDialog>
    );
  }

  return {
    dialog,
    canRun: settings?.run ?? false,
    canToggle: settings?.toggle ?? false,
    request: (action: TaskAction, task: TaskRow) => setPending({ action, task }),
  };
}

export type TaskActions = ReturnType<typeof useTaskActions>;
