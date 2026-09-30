import { useCallback, useMemo } from 'react';
import type { SchedulerRange, SchedulerTab, TaskDetailTab } from '../types/scheduler.types';
import { useConsoleRoute } from '../context/console-route-context';
import { DEFAULT_SCHEDULER_RANGE, SCHEDULER_RANGES, SCHEDULER_TABS, TASK_DETAIL_TABS } from '../constants/scheduler';
import { toQuery } from '../services/traffic.api';

const SECTION = 'scheduler';
type Query = Record<string, string | number | undefined>;

/**
 * `scheduler/<tab>/<taskId>/<sub>?range=&exec=` — tab, task đang mở (Task Detail) + tab con, và lần chạy đang xem
 * (`exec`, drawer mở được từ mọi tab) nằm trên URL: chia sẻ được, Back hoạt động.
 */
export function useSchedulerRoute() {
  const { route, navigate } = useConsoleRoute();
  const [rawTab, rawId, rawSub] = route.params;
  const tab: SchedulerTab = SCHEDULER_TABS.includes(rawTab as SchedulerTab) ? (rawTab as SchedulerTab) : 'overview';
  const sub: TaskDetailTab = TASK_DETAIL_TABS.includes(rawSub as TaskDetailTab) ? (rawSub as TaskDetailTab) : 'overview';
  const range = useMemo<SchedulerRange>(() => {
    const r = route.query.get('range') as SchedulerRange | null;
    return r && SCHEDULER_RANGES.includes(r) ? r : DEFAULT_SCHEDULER_RANGE;
  }, [route.query]);
  const exec = route.query.get('exec');
  const extra = useMemo(() => Object.fromEntries([...route.query.entries()].filter(([k]) => k !== 'range' && k !== 'exec')), [route.query]);

  const build = useCallback(
    (segments: string[], query: Query) => {
      const qs = toQuery({ ...query, range: range === DEFAULT_SCHEDULER_RANGE ? undefined : range });
      navigate(`${[SECTION, ...segments].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [navigate, range],
  );

  const go = useCallback((nextTab: SchedulerTab, query: Query = {}) => build(nextTab === 'overview' ? [] : [nextTab], query), [build]);

  const openTask = useCallback(
    (taskId: string, subTab: TaskDetailTab = 'overview') => build(['tasks', encodeURIComponent(taskId), ...(subTab === 'overview' ? [] : [subTab])], {}),
    [build],
  );

  /** Mở / đóng drawer lần chạy mà vẫn giữ trang hiện tại. */
  const setExec = useCallback(
    (executionId: string | null) => {
      const qs = toQuery({ ...extra, range: range === DEFAULT_SCHEDULER_RANGE ? undefined : range, exec: executionId ?? undefined });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [extra, navigate, range, route.params],
  );

  const setRange = useCallback(
    (r: SchedulerRange) => {
      const qs = toQuery({ ...extra, range: r === DEFAULT_SCHEDULER_RANGE ? undefined : r, exec: exec ?? undefined });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [exec, extra, navigate, route.params],
  );

  return { tab, taskId: rawId ? decodeURIComponent(rawId) : null, sub, range, exec, query: extra, go, openTask, setExec, setRange, navigate };
}
