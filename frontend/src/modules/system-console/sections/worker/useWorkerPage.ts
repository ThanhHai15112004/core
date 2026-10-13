import { useCallback, useState } from 'react';
import { setSearchParams } from '@core/router';
import { useTimeRange } from '@core/data';
import type { JobRow, WorkerTab } from '../../types/worker.types';
import {
  ACTIVITY_VIEWS,
  QUEUE_PAGE_TABS,
  QUEUE_SUB_ALIASES,
  WORKER_PAGE_TABS,
  WORKER_RANGES,
  WORKER_TAB_ALIASES,
  type ActivityView,
  type QueuePageTab,
  type WorkerPageTab,
} from '../../constants/worker';
import { useSectionRoute } from '../../shell/useSectionRoute';
import type { QueueActionRequest } from '../../components/worker/QueueActionDialog';

const isIn = <T extends string>(list: readonly T[], v: string | null | undefined): v is T => v !== null && v !== undefined && (list as readonly string[]).includes(v);

/**
 * Route của Worker & Queue:
 *   `worker[/<tab>]`, `worker/queues/<name>[/jobs|failures]` (trang chi tiết queue),
 *   `worker/workers?item=<id>` (drawer worker instance), `worker/activity?view=failures|delayed|events|operations`,
 *   `?settings=1` mở sheet cấu hình.
 * Link cũ: `failures` / `delayed` / `events` → `activity?view=…`, `configuration` → sheet, `workers/<id>` → drawer,
 * tab con cũ của queue (`workers`, `metrics`, `configuration`) → Tổng quan của queue.
 */
export function useWorkerPage() {
  const r = useSectionRoute<WorkerPageTab>(WORKER_PAGE_TABS, WORKER_TAB_ALIASES);
  const { tab, params, query, navigate } = r;
  const range = useTimeRange(WORKER_RANGES);
  const [action, setAction] = useState<QueueActionRequest | null>(null);

  const queueName = tab === 'queues' ? (params[0] ?? null) : null;
  const rawSub = params[1];
  const queueTab: QueuePageTab = isIn(QUEUE_PAGE_TABS, rawSub) ? rawSub : ((rawSub ? QUEUE_SUB_ALIASES[rawSub] : undefined) ?? 'overview');
  const legacyWorker = tab === 'workers' ? (params[0] ?? null) : null;
  const workerId = query.get('item') ?? legacyWorker;
  const rawView = query.get('view');
  const view: ActivityView = isIn(ACTIVITY_VIEWS, rawView) ? rawView : 'failures';

  const go = useCallback((next: WorkerPageTab) => r.go(next), [r]);
  const openQueue = useCallback((name: string, sub: QueuePageTab = 'overview') => r.go('queues', sub === 'overview' ? [name] : [name, sub]), [r]);
  const setView = useCallback((v: ActivityView) => r.go('activity', [], { view: v === 'failures' ? undefined : v }), [r]);
  /** Drawer: thêm vào lịch sử để nút Back đóng được. */
  const openWorker = useCallback(
    (id: string | null) => {
      if (!id && legacyWorker) r.go('workers');
      else setSearchParams({ item: id }, id ? 'push' : 'replace');
    },
    [legacyWorker, r],
  );
  const setSettings = useCallback((open: boolean) => setSearchParams({ settings: open ? '1' : null }, open ? 'push' : 'replace'), []);
  const openJob = useCallback(
    (j: Pick<JobRow, 'id' | 'queue'>) => navigate(`jobs/job/${encodeURIComponent(j.id)}?queue=${encodeURIComponent(j.queue)}`),
    [navigate],
  );
  /** Tab cũ do backend gửi kèm cảnh báo / sự kiện → đúng chỗ trên cấu trúc mới. */
  const openLegacyTab = useCallback(
    (legacy: WorkerTab) => {
      const alias = (WORKER_TAB_ALIASES as Record<string, { tab: WorkerPageTab; query?: Record<string, string> }>)[legacy];
      if (alias) r.go(alias.tab, [], alias.query);
      else r.go(isIn(WORKER_PAGE_TABS, legacy) ? legacy : 'overview');
    },
    [r],
  );

  return {
    tab,
    range,
    queueName,
    queueTab,
    workerId,
    view,
    settingsOpen: query.get('settings') === '1',
    action,
    requestAction: setAction,
    go,
    openQueue,
    setView,
    openWorker,
    openJob,
    openLegacyTab,
    setSettings,
    navigate,
  };
}

export type WorkerPage = ReturnType<typeof useWorkerPage>;
