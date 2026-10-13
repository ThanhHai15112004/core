import { useCallback, useMemo } from 'react';
import { setSearchParams } from '@core/router';
import { useTimeRange } from '@core/data';
import type { JobFilters, JobPriorityLevel, JobSourceKind, JobStatus, JobsRange, JobsWindow, StatusFilter } from '../../types/jobs.types';
import {
  JOB_DETAIL_ALIASES,
  JOB_DETAIL_TABS,
  JOB_PRIORITIES,
  JOB_SOURCES,
  JOBS_RANGES,
  JOBS_TAB_ALIASES,
  JOBS_TABS,
  JOBS_WINDOWS,
  STATUS_FILTERS,
  type JobDetailPageTab,
  type JobFilterKey,
  type JobsPageTab,
} from '../../constants/jobs';
import { useSectionRoute } from '../../shell/useSectionRoute';

/** Bộ lọc Explorer dạng query URL (giá trị thô). */
export type JobQuery = Partial<Record<JobFilterKey, string | number | undefined>>;

export interface ExplorerFilters {
  status: StatusFilter;
  /** Bộ lọc gửi API. */
  api: JobFilters;
  /** Bộ lọc đang bật (cho chip / nút xoá). */
  query: JobQuery;
}

function filtersOf(q: URLSearchParams): ExplorerFilters {
  const pick = <T extends string>(key: string, allowed: readonly T[]) => {
    const v = q.get(key) as T | null;
    return v && allowed.includes(v) ? v : undefined;
  };
  const num = (key: string) => {
    const raw = q.get(key);
    const v = Number(raw);
    return raw && Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const text = (key: string) => q.get(key)?.trim() || undefined;
  const status = pick<StatusFilter>('status', STATUS_FILTERS) ?? 'all';
  const query: JobQuery = {
    status: status === 'all' ? undefined : status,
    q: text('q'),
    queue: text('queue'),
    type: text('type'),
    window: pick<JobsWindow>('window', JOBS_WINDOWS),
    worker: text('worker'),
    source: pick<JobSourceKind>('source', JOB_SOURCES),
    minAttempts: num('minAttempts'),
    minDurationMs: num('minDurationMs'),
    errorType: text('errorType'),
    priority: pick<JobPriorityLevel>('priority', JOB_PRIORITIES),
  };
  const api: JobFilters = {
    status: status === 'all' ? undefined : (status as JobStatus),
    queue: query.queue as string | undefined,
    type: query.type as string | undefined,
    search: query.q as string | undefined,
    window: query.window as JobsWindow | undefined,
    worker: query.worker as string | undefined,
    source: query.source as JobSourceKind | undefined,
    minAttempts: query.minAttempts as number | undefined,
    minDurationMs: query.minDurationMs as number | undefined,
    errorType: query.errorType as string | undefined,
    priority: query.priority as JobPriorityLevel | undefined,
  };
  const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return { status, api: clean(api), query: clean(query) };
}

/**
 * Route của Jobs:
 *   `jobs[/<tab>]`, `jobs/explorer?status=&queue=&q=…` (bộ lọc trên URL),
 *   `jobs/job/<id>[/<tab>]?queue=` (Job Detail — trang con, giữ đường dẫn cũ), `?settings=1` mở sheet cấu hình.
 * Link cũ: `performance` → Tổng quan, `events` → Hoạt động, `configuration` → sheet cấu hình,
 * tab con cũ của Job Detail (`lifecycle`, `logs`, `configuration`) → tab mới tương ứng.
 */
export function useJobsPage() {
  const r = useSectionRoute<JobsPageTab>(JOBS_TABS, JOBS_TAB_ALIASES);
  const { navigate, query } = r;
  const isDetail = r.tab === 'overview' && r.params[0] === 'job' && Boolean(r.params[1]);
  const jobId = isDetail ? r.params[1] : null;
  const rawSub = isDetail ? r.params[2] : undefined;
  const detailTab: JobDetailPageTab = rawSub
    ? (JOB_DETAIL_TABS as readonly string[]).includes(rawSub)
      ? (rawSub as JobDetailPageTab)
      : (JOB_DETAIL_ALIASES[rawSub] ?? 'overview')
    : 'overview';
  const detailQueue = isDetail ? query.get('queue') : null;
  const filters = useMemo(() => filtersOf(query), [query]);
  const range = useTimeRange<JobsRange>(JOBS_RANGES);

  const go = useCallback((next: JobsPageTab) => r.go(next), [r]);
  /** Explorer với bộ lọc (thay toàn bộ bộ lọc hiện tại). */
  const explore = useCallback((q: JobQuery = {}) => r.go('explorer', [], { ...q, status: q.status === 'all' ? undefined : q.status }), [r]);
  const openJob = useCallback(
    (id: string, queue?: string | null, tab: JobDetailPageTab = 'overview') => {
      const path = [r.section, 'job', encodeURIComponent(id), ...(tab === 'overview' ? [] : [tab])].join('/');
      navigate(`${path}${queue ? `?queue=${encodeURIComponent(queue)}` : ''}`);
    },
    [r.section, navigate],
  );
  const setDetailTab = useCallback((tab: JobDetailPageTab) => jobId && openJob(jobId, detailQueue, tab), [jobId, detailQueue, openJob]);
  const setSettings = useCallback((open: boolean) => setSearchParams({ settings: open ? '1' : null }, open ? 'push' : 'replace'), []);

  return {
    tab: r.tab,
    isDetail,
    jobId,
    detailTab,
    detailQueue,
    range,
    filters,
    settingsOpen: query.get('settings') === '1',
    go,
    explore,
    openJob,
    setDetailTab,
    setSettings,
    navigate,
  };
}

export type JobsPage = ReturnType<typeof useJobsPage>;
