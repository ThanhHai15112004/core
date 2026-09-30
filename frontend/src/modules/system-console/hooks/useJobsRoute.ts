import { useCallback, useMemo } from 'react';
import type { JobDetailTab, JobFilters, JobPriorityLevel, JobSourceKind, JobStatus, JobsRange, JobsTab, JobsWindow, StatusFilter } from '../types/jobs.types';
import { useConsoleRoute } from '../context/console-route-context';
import { DEFAULT_JOBS_RANGE, JOB_DETAIL_TABS, JOBS_RANGES, JOBS_TABS, JOBS_WINDOWS, JOB_PRIORITIES, JOB_SOURCES, STATUS_FILTERS } from '../constants/jobs';
import { toQuery } from '../services/traffic.api';

const SECTION = 'jobs';
type Query = Record<string, string | number | undefined>;

/** Query → bộ lọc Explorer (giá trị lạ bị bỏ qua). */
function filtersOf(q: URLSearchParams): JobFilters & { statusTab: StatusFilter } {
  const pick = <T extends string>(key: string, allowed: readonly T[]) => {
    const v = q.get(key) as T | null;
    return v && allowed.includes(v) ? v : undefined;
  };
  const num = (key: string) => {
    const v = Number(q.get(key));
    return q.get(key) && Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const text = (key: string) => q.get(key)?.trim() || undefined;
  const statusTab = pick<StatusFilter>('status', STATUS_FILTERS) ?? 'all';
  const f: JobFilters & { statusTab: StatusFilter } = { statusTab };
  const set = <K extends keyof JobFilters>(k: K, v: JobFilters[K] | undefined) => {
    if (v !== undefined) (f as JobFilters)[k] = v;
  };
  set('status', statusTab === 'all' ? undefined : (statusTab as JobStatus));
  set('queue', text('queue'));
  set('type', text('type'));
  set('search', text('q'));
  set('window', pick<JobsWindow>('window', JOBS_WINDOWS));
  set('worker', text('worker'));
  set('source', pick<JobSourceKind>('source', JOB_SOURCES));
  set('minAttempts', num('minAttempts'));
  set('minDurationMs', num('minDurationMs'));
  set('errorType', text('errorType'));
  set('priority', pick<JobPriorityLevel>('priority', JOB_PRIORITIES));
  return f;
}

/**
 * `jobs/<tab>?range=&status=&queue=&q=…` và `jobs/job/<id>/<sub>?queue=` — tab, bộ lọc Explorer, job đang mở (Job Detail
 * là trang riêng) và tab con nằm trên URL: chia sẻ được, Back hoạt động.
 */
export function useJobsRoute() {
  const { route, navigate } = useConsoleRoute();
  const [rawTab, rawId, rawSub] = route.params;
  const jobId = rawTab === 'job' && rawId ? decodeURIComponent(rawId) : null;
  const tab: JobsTab = JOBS_TABS.includes(rawTab as JobsTab) ? (rawTab as JobsTab) : 'overview';
  const sub: JobDetailTab = JOB_DETAIL_TABS.includes(rawSub as JobDetailTab) ? (rawSub as JobDetailTab) : 'overview';
  const range = useMemo<JobsRange>(() => {
    const r = route.query.get('range') as JobsRange | null;
    return r && JOBS_RANGES.includes(r) ? r : DEFAULT_JOBS_RANGE;
  }, [route.query]);
  const filters = useMemo(() => filtersOf(route.query), [route.query]);
  const detailQueue = route.query.get('queue');

  const withRange = useCallback(
    (q: Query) =>
      toQuery({
        ...q,
        range: range === DEFAULT_JOBS_RANGE ? undefined : range,
      }),
    [range],
  );

  const go = useCallback(
    (nextTab: JobsTab, query: Query = {}) => {
      const qs = withRange(query);
      navigate(`${[SECTION, ...(nextTab === 'overview' ? [] : [nextTab])].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [navigate, withRange],
  );

  /** Explorer với bộ lọc (status, queue, errorType…). */
  const explore = useCallback(
    (
      f: Partial<
        Record<
          'status' | 'queue' | 'type' | 'q' | 'window' | 'worker' | 'source' | 'minAttempts' | 'minDurationMs' | 'errorType' | 'priority',
          string | number | undefined
        >
      >,
    ) =>
      go('explorer', {
        ...f,
        status: f.status === 'all' ? undefined : f.status,
      }),
    [go],
  );

  const openJob = useCallback(
    (id: string, queue?: string | null, subTab: JobDetailTab = 'overview') => {
      const qs = toQuery({ queue: queue ?? undefined });
      navigate(`${[SECTION, 'job', encodeURIComponent(id), ...(subTab === 'overview' ? [] : [subTab])].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [navigate],
  );

  const setRange = useCallback(
    (r: JobsRange) => {
      const extra = Object.fromEntries([...route.query.entries()].filter(([k]) => k !== 'range'));
      const qs = toQuery({
        ...extra,
        range: r === DEFAULT_JOBS_RANGE ? undefined : r,
      });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [navigate, route.params, route.query],
  );

  return {
    tab,
    jobId,
    sub,
    detailQueue,
    range,
    filters,
    go,
    explore,
    openJob,
    setRange,
    navigate,
  };
}
