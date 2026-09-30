import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { JobCapability, JobFilters, JobRow, JobSearchResult, JobsRange, JobsSettings, StatusFilter } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { usePolling } from '../../hooks/usePolling';
import { JobSearchBox } from '../../components/jobs/JobSearchBox';
import { JobTable } from '../../components/jobs/JobTable';
import {
  COLUMNS_OF,
  JOB_PRIORITIES,
  JOB_SOURCES,
  JOBS_WINDOWS,
  OPTIONAL_COLUMNS,
  STATUS_CAPABILITY,
  STATUS_FILTERS,
  type JobColumn,
} from '../../constants/jobs';
import { useLocale } from '../../../../core/i18n/index';

const PAGE = 50;
type Explore = (f: Record<string, string | number | undefined>) => void;

/** Bộ lọc hiện tại → query URL (giữ nguyên các bộ lọc khác khi đổi một bộ lọc). */
function toQueryFilters(f: JobFilters & { statusTab: StatusFilter }): Record<string, string | number | undefined> {
  return {
    status: f.statusTab === 'all' ? undefined : f.statusTab,
    queue: f.queue,
    type: f.type,
    q: f.search,
    window: f.window,
    worker: f.worker,
    source: f.source,
    minAttempts: f.minAttempts,
    minDurationMs: f.minDurationMs,
    errorType: f.errorType,
    priority: f.priority,
  };
}

/**
 * Job Explorer: tìm đúng job (ID / correlation / request / idempotency / `field=value` / loại job), lọc theo trạng thái,
 * queue, loại, thời gian + More Filters; bảng có cột theo trạng thái; phân trang bằng cursor ("Load more") — không tải
 * cả nghìn job. Tab Failed cho chọn nhiều job để retry có xem trước.
 */
export const JobsExplorerView: React.FC<{
  range: JobsRange;
  paused: boolean;
  reloadKey: number;
  now: number;
  filters: JobFilters & { statusTab: StatusFilter };
  queues: string[];
  capabilities: JobCapability[];
  settings: JobsSettings | null;
  explore: Explore;
  openJob: (id: string, queue?: string | null) => void;
  onBulkRetry: (jobs: JobRow[]) => void;
}> = ({ paused, reloadKey, now, filters, queues, capabilities, settings, explore, openJob, onBulkRetry }) => {
  const { t } = useLocale();
  const { statusTab, ...api } = filters;
  const key = JSON.stringify(api) + reloadKey;
  const [more, setMore] = useState<{
    rows: JobRow[];
    cursor: string | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(() =>
    Boolean(filters.worker || filters.source || filters.minAttempts || filters.minDurationMs || filters.errorType || filters.priority),
  );
  const [optional, setOptional] = useState<JobColumn[]>([]);
  const [selected, setSelected] = useState<Map<string, JobRow>>(new Map());
  // Đã tải thêm trang → ngừng làm mới trang đầu (để danh sách không nhảy khi đang xem).
  const first = usePolling<JobSearchResult>(() => jobsApi.search(api, null, PAGE), key, undefined, paused || more !== null);

  useEffect(() => {
    setMore(null);
    setMoreError(null);
    setSelected(new Map());
  }, [key]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return [...(first.data?.jobs ?? []), ...(more?.rows ?? [])].filter((j) => {
      const k = `${j.queue}|${j.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [first.data, more]);
  const nextCursor = more ? more.cursor : (first.data?.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const r = await jobsApi.search(api, nextCursor, PAGE);
      setMore((m) => ({
        rows: [...(m?.rows ?? []), ...r.jobs],
        cursor: r.nextCursor,
      }));
    } catch (err) {
      setMoreError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [api, nextCursor]);

  const set = (patch: Record<string, string | number | undefined>) => explore({ ...toQueryFilters(filters), ...patch });
  const cap = STATUS_CAPABILITY[statusTab];
  const unsupported = cap && capabilities.length > 0 && !capabilities.includes(cap);
  const columns = [...COLUMNS_OF[statusTab], ...optional.filter((c) => !COLUMNS_OF[statusTab].includes(c))];
  const selectable = statusTab === 'failed' && (settings?.retry ?? false);
  const toggle = (j: JobRow) =>
    setSelected((m) => {
      const n = new Map(m);
      const k = `${j.queue}|${j.id}`;
      if (n.has(k)) n.delete(k);
      else n.set(k, j);
      return n;
    });
  const toggleAll = (list: JobRow[], on: boolean) =>
    setSelected((m) => {
      const n = new Map(m);
      for (const j of list) {
        const k = `${j.queue}|${j.id}`;
        if (on) n.set(k, j);
        else n.delete(k);
      }
      return n;
    });
  const res = first.data;
  const finishedOnly = statusTab === 'completed' || statusTab === 'failed' || statusTab === 'cancelled' || statusTab === 'all';

  return (
    <section className="ov-card ov-section">
      <div className="job-filterbar">
        <JobSearchBox value={filters.search ?? ''} onSubmit={(q) => set({ q: q || undefined })} />
        <label className="sch-filter">
          {t('jobs.filter.queue')}
          <select value={filters.queue ?? ''} onChange={(e) => set({ queue: e.target.value || undefined })}>
            <option value="">{t('jobs.filter.allQueues')}</option>
            {queues.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </label>
        <label className="sch-filter">
          {t('jobs.filter.type')}
          <input
            className="job-input"
            defaultValue={filters.type ?? ''}
            key={filters.type ?? ''}
            placeholder={t('jobs.filter.anyType')}
            onBlur={(e) => e.target.value.trim() !== (filters.type ?? '') && set({ type: e.target.value.trim() || undefined })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <label className="sch-filter" title={t('jobs.filter.timeHint')}>
          {t('jobs.filter.time')}
          <select value={filters.window ?? ''} onChange={(e) => set({ window: e.target.value || undefined })} disabled={!finishedOnly}>
            <option value="">{t('jobs.filter.anyTime')}</option>
            {JOBS_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {t('jobs.filter.last', { window: w })}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`scp-btn scp-btn-sm scp-btn-secondary ${showMore ? 'is-active' : ''}`}
          onClick={() => setShowMore((s) => !s)}
          aria-expanded={showMore}
        >
          <SlidersHorizontal size={13} /> {t('jobs.filter.more')}
        </button>
      </div>

      {showMore && (
        <div className="job-filterbar job-filterbar-more">
          <label className="sch-filter">
            {t('jobs.col.worker')}
            <input
              className="job-input"
              defaultValue={filters.worker ?? ''}
              key={`w${filters.worker ?? ''}`}
              onBlur={(e) => e.target.value.trim() !== (filters.worker ?? '') && set({ worker: e.target.value.trim() || undefined })}
            />
          </label>
          <label className="sch-filter">
            {t('jobs.col.source')}
            <select value={filters.source ?? ''} onChange={(e) => set({ source: e.target.value || undefined })}>
              <option value="">{t('jobs.filter.any')}</option>
              {JOB_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`jobs.source.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="sch-filter">
            {t('jobs.filter.minAttempts')}
            <input
              className="job-input job-input-sm"
              type="number"
              min={0}
              defaultValue={filters.minAttempts ?? ''}
              key={`a${filters.minAttempts ?? ''}`}
              onBlur={(e) =>
                set({
                  minAttempts: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </label>
          <label className="sch-filter">
            {t('jobs.filter.minDuration')}
            <input
              className="job-input job-input-sm"
              type="number"
              min={0}
              defaultValue={filters.minDurationMs ? filters.minDurationMs / 1000 : ''}
              key={`d${filters.minDurationMs ?? ''}`}
              onBlur={(e) =>
                set({
                  minDurationMs: e.target.value ? Math.round(Number(e.target.value) * 1000) : undefined,
                })
              }
            />
          </label>
          <label className="sch-filter">
            {t('jobs.filter.errorType')}
            <input
              className="job-input"
              defaultValue={filters.errorType ?? ''}
              key={`e${filters.errorType ?? ''}`}
              onBlur={(e) => e.target.value.trim() !== (filters.errorType ?? '') && set({ errorType: e.target.value.trim() || undefined })}
            />
          </label>
          <label className="sch-filter">
            {t('jobs.col.priority')}
            <select value={filters.priority ?? ''} onChange={(e) => set({ priority: e.target.value || undefined })}>
              <option value="">{t('jobs.filter.any')}</option>
              {JOB_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`jobs.priority.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <span className="sch-filter">
            {t('jobs.filter.columns')}
            {OPTIONAL_COLUMNS.map((c) => (
              <label key={c} className="job-check">
                <input
                  type="checkbox"
                  checked={optional.includes(c)}
                  onChange={(e) => setOptional((o) => (e.target.checked ? [...o, c] : o.filter((x) => x !== c)))}
                />
                {t(`jobs.col.${c}`)}
              </label>
            ))}
          </span>
          <button type="button" className="ov-link" onClick={() => explore({ status: statusTab === 'all' ? undefined : statusTab })}>
            {t('jobs.filter.clear')}
          </button>
        </div>
      )}

      <nav className="rt-tabs job-status-tabs" role="tablist" aria-label={t('jobs.explorer.status')}>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={statusTab === s}
            className={statusTab === s ? 'is-active' : ''}
            onClick={() => set({ status: s === 'all' ? undefined : s })}
          >
            {t(`jobs.statusTab.${s}`)}
          </button>
        ))}
      </nav>
      <p className="ov-muted job-note">{t(`jobs.statusHint.${statusTab}`)}</p>

      {unsupported ? (
        <section className="tr-empty-state" role="status">
          <Ban size={28} />
          <h2>{t('wq.unsupported.title')}</h2>
        </section>
      ) : (
        <>
          {res?.mode === 'lookup' && res.matchedBy && (
            <p className="tr-filter-chip">
              {t(`jobs.search.matched.${res.matchedBy}`)} <code>{filters.search}</code> · {t('jobs.search.found', { count: res.jobs.length })}
            </p>
          )}
          {selectable && selected.size > 0 && (
            <div className="job-bulkbar">
              <span>{t('jobs.select.count', { count: selected.size })}</span>
              <button type="button" className="scp-btn scp-btn-sm scp-btn-primary" onClick={() => onBulkRetry([...selected.values()])}>
                <RotateCcw size={13} /> {t('jobs.select.retry', { count: selected.size })}
              </button>
              <button type="button" className="ov-link" onClick={() => setSelected(new Map())}>
                {t('jobs.select.clear')}
              </button>
            </div>
          )}
          {first.error && !res && <p className="scp-alert scp-alert-danger">{first.error.message}</p>}
          {!res && !first.error && <p className="ov-empty-line">{t('common.loading')}</p>}
          {res && (
            <JobTable
              rows={rows}
              columns={columns}
              now={now}
              onOpen={(j) => openJob(j.id, j.queue)}
              emptyText={t(res.truncated ? 'jobs.explorer.emptyTruncated' : 'jobs.explorer.empty')}
              {...(selectable
                ? {
                    selected: new Set(selected.keys()),
                    onToggle: toggle,
                    onToggleAll: toggleAll,
                    canSelect: (j: JobRow) => j.status === 'failed' && j.retryable !== false,
                  }
                : {})}
            />
          )}
          <footer className="ov-section-foot job-pager">
            <span className="ov-muted">
              {t('jobs.explorer.showing', { count: rows.length })}
              {res?.truncated && ` · ${t('jobs.explorer.truncated', { count: res.scanned })}`}
            </span>
            {nextCursor && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? t('common.loading') : t('jobs.explorer.loadMore')}
              </button>
            )}
            {moreError && <span className="is-warn">{moreError}</span>}
          </footer>
        </>
      )}
    </section>
  );
};
