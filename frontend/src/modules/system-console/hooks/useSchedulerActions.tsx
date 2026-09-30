import { useCallback, useEffect, useState } from 'react';
import type { SchedulerSettings, TaskRow } from '../types/scheduler.types';
import { schedulerApi } from '../services/scheduler.api';
import { DbActionModal } from '../components/database/DbActionModal';
import { useConsoleData } from '../context/console-data-context';
import { formatIn, secondsUntil } from '../utils/scheduler-format';
import { NO_VALUE } from '../utils/runtime-format';
import { useLocale } from '../../../core/i18n/index';

export type TaskAction = 'run' | 'enable' | 'disable';

/** Lần chạy kế tiếp nếu bật lại task (task đang tắt thì backend không lên lịch → tính theo lịch). */
function useNextAfterEnable(task: TaskRow | null) {
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    setNext(null);
    if (!task) return;
    const s = task.schedule;
    if (s.type === 'one_time') return setNext(s.runAt && Date.parse(s.runAt) > Date.now() ? s.runAt : null);
    if (s.type === 'interval' && s.intervalMs) return setNext(new Date(Math.ceil((Date.now() + 1) / s.intervalMs) * s.intervalMs).toISOString());
    if (!s.expression) return;
    let alive = true;
    schedulerApi
      .cron(s.expression, s.timezone)
      .then((r) => alive && setNext(r.next[0] ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [task]);
  return next;
}

/**
 * Run Now / Enable / Disable với modal nói rõ điều gì xảy ra (môi trường, lần chạy gần nhất, trạng thái, lịch kế
 * tiếp) + toast. Task đang chạy mà overlap = Prevent → modal chỉ giải thích, không cho chạy chồng.
 */
export function useSchedulerActions(
  settings: SchedulerSettings | null | undefined,
  environment: string,
  onDone: (action: TaskAction, task: TaskRow, executionId?: string) => void,
) {
  const { t, formatRelative } = useLocale();
  const { addToast } = useConsoleData();
  const [pending, setPending] = useState<{ action: TaskAction; task: TaskRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const nextAfterEnable = useNextAfterEnable(pending?.action === 'enable' ? pending.task : null);

  const run = useCallback(async () => {
    if (!pending) return;
    const { action, task } = pending;
    setBusy(true);
    try {
      if (action === 'run') {
        const r = await schedulerApi.run(task.id);
        addToast({ type: 'success', title: t('sch.action.done.run', { task: task.name }), message: r.executionId });
        onDone(action, task, r.executionId);
      } else {
        await (action === 'enable' ? schedulerApi.enable(task.id) : schedulerApi.disable(task.id));
        addToast({ type: 'success', title: t(`sch.action.done.${action}`, { task: task.name }) });
        onDone(action, task);
      }
      setPending(null);
    } catch (err) {
      addToast({ type: 'error', title: t('sch.action.failed'), message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [addToast, onDone, pending, t]);

  let modal: React.ReactNode = null;
  if (pending) {
    const { action, task } = pending;
    const now = Date.now();
    const blocked = action === 'run' && task.running > 0 && task.overlap === 'skip';
    const last = task.lastRunAt
      ? `${task.lastStatus ? t(`sch.exec.status.${task.lastStatus}`) : ''} · ${formatRelative(new Date(task.lastRunAt), now)}`
      : t('sch.task.never');
    const next = (at: string | null) => (at ? `${new Date(at).toLocaleString()} (${formatIn(secondsUntil(at, now))})` : NO_VALUE);
    const context = {
      run: [
        { label: t('sch.modal.environment'), value: <strong>{environment.toUpperCase()}</strong> },
        { label: t('sch.modal.lastRun'), value: last },
        { label: t('sch.modal.state'), value: task.running > 0 ? t('sch.modal.running', { count: task.running }) : t('sch.modal.idle') },
        { label: t('sch.task.overlap'), value: t(`sch.overlap.${task.overlap}`) },
      ],
      disable: [
        { label: t('sch.modal.nextScheduled'), value: next(task.nextRunAt) },
        { label: t('sch.modal.state'), value: task.running > 0 ? t('sch.modal.running', { count: task.running }) : t('sch.modal.idle') },
      ],
      enable: [
        { label: t('sch.modal.nextAfterEnable'), value: next(nextAfterEnable) },
        { label: t('sch.task.misfire'), value: t(`sch.misfire.${task.misfire}`) },
      ],
    }[action];
    modal = (
      <DbActionModal
        title={t(`sch.modal.${action}.title`, { task: task.name })}
        context={[
          { label: t('sch.task.name'), value: <code>{task.name}</code> },
          { label: t('sch.task.schedule'), value: `${task.schedule.description} · ${task.schedule.timezone}` },
          ...context,
        ]}
        warning={blocked ? t('sch.modal.run.blocked') : t(`sch.modal.${action}.warning`)}
        confirmLabel={t(`sch.modal.${action}.confirm`)}
        confirmDisabled={blocked}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void run()}
      />
    );
  }

  return {
    modal,
    canRun: settings?.run ?? false,
    canToggle: settings?.toggle ?? false,
    request: (action: TaskAction, task: TaskRow) => setPending({ action, task }),
  };
}
