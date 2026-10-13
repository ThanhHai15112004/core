import { useCallback, useMemo } from 'react';
import { setSearchParams } from '@core/router';
import { useTimeRange } from '@core/data';
import type { ExecutionStatus, ExecutionTrigger } from '../../types/scheduler.types';
import {
  EXECUTION_STATUSES,
  EXECUTION_TRIGGERS,
  SCHEDULER_RANGES,
  SCHEDULER_TABS,
  TASK_DETAIL_ALIASES,
  TASK_DETAIL_TABS,
  type SchedulerPageTab,
  type TaskPageTab,
} from '../../constants/scheduler';
import { useSectionRoute } from '../../shell/useSectionRoute';

export interface HistoryFilters {
  status: ExecutionStatus[];
  trigger: ExecutionTrigger[];
  /** Task id ('' = mọi task). */
  task: string;
}

const listOf = <T extends string>(raw: string | null, allowed: readonly T[]): T[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));

/**
 * Route của Scheduler:
 *   `scheduler[/<tab>]`, `scheduler/tasks/<id>[/history]` (trang task), `scheduler/history?status=&trigger=&task=`,
 *   `?exec=<id>` mở drawer lần chạy ở mọi tab, `?settings=1` mở sheet cấu hình.
 * Link cũ: `failures` → Lịch sử lọc lỗi, `events` → Tổng quan, `configuration` → sheet cấu hình;
 * tab con cũ của task: `metrics` / `configuration` → Tổng quan, `logs` → Lịch sử.
 */
export function useSchedulerPage() {
  const r = useSectionRoute<SchedulerPageTab>(SCHEDULER_TABS, {
    failures: { tab: 'history', query: { status: 'failed' } },
    events: { tab: 'overview' },
    configuration: { tab: 'overview', query: { settings: '1' } },
  });
  const { query, navigate } = r;
  const range = useTimeRange(SCHEDULER_RANGES);
  const taskId = r.tab === 'tasks' ? (r.params[0] ?? null) : null;
  const rawSub = r.params[1] ?? '';
  const sub: TaskPageTab = (TASK_DETAIL_TABS as readonly string[]).includes(rawSub) ? (rawSub as TaskPageTab) : (TASK_DETAIL_ALIASES[rawSub] ?? 'overview');
  const statusQ = query.get('status');
  const triggerQ = query.get('trigger');
  const taskQ = query.get('task');
  const filters = useMemo<HistoryFilters>(
    () => ({ status: listOf(statusQ, EXECUTION_STATUSES), trigger: listOf(triggerQ, EXECUTION_TRIGGERS), task: taskQ ?? '' }),
    [statusQ, triggerQ, taskQ],
  );

  const go = useCallback((tab: SchedulerPageTab, q?: Record<string, string>) => r.go(tab, [], q), [r]);
  const openTask = useCallback((id: string, next: TaskPageTab = 'overview') => r.go('tasks', next === 'overview' ? [id] : [id, next]), [r]);
  const setFilters = useCallback(
    (patch: Partial<HistoryFilters>) => {
      const f = { ...filters, ...patch };
      r.setQuery({ status: f.status.join(',') || null, trigger: f.trigger.join(',') || null, task: f.task || null });
    },
    [filters, r],
  );
  /** Drawer / sheet: thêm vào lịch sử để nút Back đóng được. */
  const openExec = useCallback((id: string | null) => setSearchParams({ exec: id }, id ? 'push' : 'replace'), []);
  const setSettings = useCallback((open: boolean) => setSearchParams({ settings: open ? '1' : null }, open ? 'push' : 'replace'), []);

  return {
    tab: r.tab,
    taskId,
    sub,
    range,
    filters,
    execId: query.get('exec'),
    settingsOpen: query.get('settings') === '1',
    go,
    openTask,
    setFilters,
    openExec,
    setSettings,
    navigate,
  };
}

export type SchedulerPage = ReturnType<typeof useSchedulerPage>;
