import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import {
  Badge,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from '@core/ui/primitives';
import { FilterBar, Panel, PanelState, StatusBanner } from '@core/ui/blocks';
import type { JobRow, JobsOverview, StatusFilter } from '../../types/jobs.types';
import {
  COLUMNS_OF,
  EXPLORER_TABLE_HEIGHT_PX,
  FINISHED_FILTERS,
  JOB_PRIORITIES,
  JOB_SOURCES,
  JOBS_WINDOWS,
  MORE_FILTER_KEYS,
  OPTIONAL_COLUMNS,
  STATUS_CAPABILITY,
  STATUS_FILTERS,
  type JobColumn,
  type JobFilterKey,
} from '../../constants/jobs';
import { JobSearchBox } from '../../components/jobs/JobSearchBox';
import { JobTable, type JobSelection } from '../../components/jobs/JobTable';
import { jobKey } from '../../utils/jobs-format';
import { JobActionDialog, type JobActionRequest } from './JobActionDialog';
import { useJobSearch } from './useJobSearch';
import type { JobQuery, JobsPage } from './useJobsPage';

const ANY = '__any__';
const MS_PER_SEC = 1000;
type TextKey = 'type' | 'worker' | 'errorType' | 'minAttempts' | 'minDurationMs';

/**
 * Explorer: tìm đúng job (ID / correlation / request / idempotency / `field=value` / loại job), lọc theo trạng thái,
 * queue, loại, thời gian + thêm bộ lọc (đều nằm trên URL); bảng ảo hoá, cột theo trạng thái, tải thêm theo cursor.
 * Trạng thái Lỗi cho chọn nhiều job để retry (xem trước trong hộp xác nhận).
 */
export function JobsExplorerTab({ page, overview }: { page: JobsPage; overview: JobsOverview | undefined }) {
  const { t } = useLocale();
  const f = useFormat();
  const { filters, explore, openJob } = page;
  const { status, api, query } = filters;
  const filterKey = JSON.stringify(api);

  const cap = STATUS_CAPABILITY[status];
  const capabilities = overview?.capabilities ?? [];
  const unsupported = Boolean(cap && capabilities.length > 0 && !capabilities.includes(cap));
  const search = useJobSearch(api, !unsupported);
  const { rows, first, last } = search;

  const [optional, setOptional] = useState<JobColumn[]>([]);
  const [selected, setSelected] = useState<Map<string, JobRow>>(new Map());
  const [request, setRequest] = useState<JobActionRequest | null>(null);
  const [draft, setDraft] = useState<Partial<Record<TextKey, string>>>({});
  useEffect(() => {
    setSelected(new Map());
    setDraft({
      type: (query.type as string) ?? '',
      worker: (query.worker as string) ?? '',
      errorType: (query.errorType as string) ?? '',
      minAttempts: query.minAttempts !== undefined ? String(query.minAttempts) : '',
      minDurationMs: query.minDurationMs !== undefined ? String(Number(query.minDurationMs) / MS_PER_SEC) : '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const set = (patch: JobQuery) => explore({ ...query, ...patch });
  const commitText = (key: TextKey) => {
    const raw = (draft[key] ?? '').trim();
    if (key === 'minAttempts') return set({ minAttempts: raw ? Number(raw) : undefined });
    if (key === 'minDurationMs') return set({ minDurationMs: raw ? Math.round(Number(raw) * MS_PER_SEC) : undefined });
    if (raw !== (query[key] ?? '')) set({ [key]: raw || undefined });
  };
  const textInput = (key: TextKey, props: { type?: string; className?: string } = {}) => (
    <Input
      value={draft[key] ?? ''}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      onBlur={() => commitText(key)}
      onKeyDown={(e) => e.key === 'Enter' && commitText(key)}
      spellCheck={false}
      type={props.type}
      min={props.type === 'number' ? 0 : undefined}
      className={props.className ?? 'h-7'}
      aria-label={t(`jobs.filter.${key}`)}
      placeholder={t(`jobs.filter.${key}`)}
    />
  );

  const columns = [...COLUMNS_OF[status], ...optional.filter((c) => !COLUMNS_OF[status].includes(c))];
  const selectable = status === 'failed' && (overview?.settings.retry ?? false);
  const selection: JobSelection | undefined = useMemo(
    () =>
      selectable
        ? {
            selected: new Set(selected.keys()),
            canSelect: (j) => j.status === 'failed' && j.retryable !== false,
            onToggle: (j) =>
              setSelected((m) => {
                const n = new Map(m);
                if (n.has(jobKey(j))) n.delete(jobKey(j));
                else n.set(jobKey(j), j);
                return n;
              }),
            onToggleAll: (list, on) =>
              setSelected((m) => {
                const n = new Map(m);
                for (const j of list) {
                  if (on) n.set(jobKey(j), j);
                  else n.delete(jobKey(j));
                }
                return n;
              }),
          }
        : undefined,
    [selectable, selected],
  );

  const chips = MORE_FILTER_KEYS.filter((k) => query[k] !== undefined);
  const chipValue = (k: JobFilterKey) => {
    const v = query[k];
    if (k === 'source') return t(`jobs.source.${v}`);
    if (k === 'priority') return t(`jobs.priority.${v}`);
    if (k === 'minDurationMs') return f.duration(Number(v));
    return String(v);
  };
  const activeCount = Object.keys(query).filter((k) => k !== 'status').length;
  const q = search.query;

  return (
    <>
      <JobSearchBox value={(query.q as string) ?? ''} onSubmit={(v) => set({ q: v || undefined })} className="mb-3" />

      <FilterBar active={activeCount > 0} onClear={() => explore({ status: query.status })}>
        <Select value={(query.queue as string) ?? ANY} onValueChange={(v) => set({ queue: v === ANY ? undefined : v })}>
          <SelectTrigger size="sm" className="w-40" aria-label={t('jobs.filter.queue')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t('jobs.filter.allQueues')}</SelectItem>
            {(overview?.queues ?? []).map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {textInput('type', { className: 'h-7 w-40' })}
        <Select value={(query.window as string) ?? ANY} onValueChange={(v) => set({ window: v === ANY ? undefined : v })} disabled={!FINISHED_FILTERS.includes(status)}>
          <SelectTrigger size="sm" className="w-36" aria-label={t('jobs.filter.time')} title={t('jobs.filter.timeHint')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t('jobs.filter.anyTime')}</SelectItem>
            {JOBS_WINDOWS.map((w) => (
              <SelectItem key={w} value={w}>
                {t('ui.time.last', { range: t(`ui.time.ranges.${w}`) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm">
              <SlidersHorizontal />
              {t('jobs.filter.more')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="grid grid-cols-2 gap-2">
              {(['worker', 'errorType'] as const).map((k) => (
                <label key={k} className="flex flex-col gap-1 text-xs text-muted">
                  {t(`jobs.filter.${k}`)}
                  {textInput(k)}
                </label>
              ))}
              {(['minAttempts', 'minDurationMs'] as const).map((k) => (
                <label key={k} className="flex flex-col gap-1 text-xs text-muted">
                  {t(`jobs.filter.${k}`)}
                  {textInput(k, { type: 'number' })}
                </label>
              ))}
              <label className="flex flex-col gap-1 text-xs text-muted">
                {t('jobs.filter.source')}
                <Select value={(query.source as string) ?? ANY} onValueChange={(v) => set({ source: v === ANY ? undefined : v })}>
                  <SelectTrigger size="sm" aria-label={t('jobs.filter.source')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{t('jobs.filter.any')}</SelectItem>
                    {JOB_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`jobs.source.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {t('jobs.filter.priority')}
                <Select value={(query.priority as string) ?? ANY} onValueChange={(v) => set({ priority: v === ANY ? undefined : v })}>
                  <SelectTrigger size="sm" aria-label={t('jobs.filter.priority')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{t('jobs.filter.any')}</SelectItem>
                    {JOB_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`jobs.priority.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="col-span-2 mt-1 border-t border-border pt-2">
                <div className="mb-1.5 text-xs text-muted">{t('jobs.filter.columns')}</div>
                <ToggleGroup type="multiple" value={optional} onValueChange={(v) => setOptional(v as JobColumn[])} className="flex-wrap">
                  {OPTIONAL_COLUMNS.map((c) => (
                    <ToggleGroupItem key={c} value={c}>
                      {t(`jobs.col.${c}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        {chips.map((k) => (
          <Badge key={k} className="h-7 gap-1.5 pr-1">
            <span className="text-muted">{t(`jobs.filter.${k}`)}:</span>
            <span className="max-w-40 truncate font-mono text-fg">{chipValue(k)}</span>
            <button type="button" onClick={() => set({ [k]: undefined })} className="rounded-sm p-0.5 text-faint hover:text-fg" aria-label={t('ui.action.clear')}>
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </FilterBar>

      <div className="mb-3 overflow-x-auto">
        <ToggleGroup type="single" value={status} onValueChange={(v) => v && set({ status: v === 'all' ? undefined : (v as StatusFilter) })} aria-label={t('jobs.explorer.status')}>
          {STATUS_FILTERS.map((s) => (
            <ToggleGroupItem key={s} value={s}>
              {t(`jobs.statusTab.${s}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {first?.mode === 'lookup' && first.matchedBy && (
        <StatusBanner tone="info" title={t('jobs.search.matchedTitle', { by: t(`jobs.search.matched.${first.matchedBy}`), value: String(query.q ?? ''), count: rows.length })} />
      )}
      {selection && selected.size > 0 && (
        <StatusBanner
          tone="info"
          title={t('jobs.select.count', { count: selected.size })}
          actions={
            <>
              <Button size="xs" variant="primary" onClick={() => setRequest({ action: 'bulk', jobs: [...selected.values()] })}>
                <RotateCcw />
                {t('jobs.select.retry', { count: selected.size })}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setSelected(new Map())}>
                {t('jobs.select.clear')}
              </Button>
            </>
          }
        />
      )}

      <Panel
        flush
        className="mb-4"
        title={first ? t('jobs.explorer.showing', { count: f.compact(rows.length) }) : t('jobs.tab.explorer')}
        hint={t(`jobs.statusHint.${status}`)}
      >
        {unsupported ? (
          <PanelState status="no-source" message={t('jobs.explorer.unsupported')} />
        ) : q.data === undefined ? (
          <PanelState status={q.isError ? 'error' : 'loading'} error={q.error} onRetry={() => void q.refetch()} className="p-3" />
        ) : (
          <JobTable
            rows={rows}
            columns={columns}
            onOpen={(j) => openJob(j.id, j.queue)}
            selection={selection}
            virtual
            maxHeight={EXPLORER_TABLE_HEIGHT_PX}
            emptyMessage={t(last?.truncated ? 'jobs.explorer.emptyTruncated' : 'jobs.explorer.empty')}
            loadMore={{ hasMore: Boolean(q.hasNextPage), loading: q.isFetchingNextPage, onLoadMore: () => void q.fetchNextPage() }}
            footer={last?.truncated ? t('jobs.explorer.truncated', { count: f.compact(last.scanned) }) : null}
          />
        )}
        {q.isFetchNextPageError && <PanelState status="error" error={q.error} compact onRetry={() => void q.fetchNextPage()} />}
      </Panel>

      <JobActionDialog
        request={request}
        onClose={() => setRequest(null)}
        settings={overview?.settings}
        environment={overview?.environment}
        onDone={() => setSelected(new Map())}
      />
    </>
  );
}
