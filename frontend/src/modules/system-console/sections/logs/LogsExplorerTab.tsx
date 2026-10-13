import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, Briefcase, CalendarClock, Download, Filter, GitBranch, Globe, Pause, Play, Radio, Search, X } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation, useLive } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Hint,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@core/ui/primitives';
import { FilterBar, Panel, PanelState, StatusBanner } from '@core/ui/blocks';
import type { ExportFormat, LogFilters, LogsOverview } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { DEFAULT_LIVE_BUFFER, EXPORT_FORMATS, EXPORT_LIMIT, FILTER_KEYS, LIVE_POLL_MS, LOG_TABLE_HEIGHT_PX, MORE_FILTER_KEYS, RUNTIMES } from '../../constants/logs';
import { browserTimeZone, contextPath, logTime } from '../../utils/logs-format';
import { LogTable } from '../../components/logs/LogTable';
import { LevelRail } from '../../components/logs/LevelRail';
import { useLogStream } from './useLogStream';
import type { LogsPage } from './useLogsPage';

const ALL = '__all__';
/** Bộ lọc cho phép rail hiển thị số đếm (các bộ lọc khác làm số không còn khớp với tổng quan). */
const RAIL_SAFE_KEYS = new Set(['level', 'window']);

const clean = (f: LogFilters): LogFilters => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')) as LogFilters;

function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Explorer kiểu log-viewer: rail level bên trái (có số đếm), ô tìm có cú pháp (dán ID), bộ lọc runtime / module /
 * thêm, bảng log 2 dòng mỗi bản ghi, live tail, tải log cũ hơn, export theo bộ lọc. Khoảng thời gian = bộ chọn chung.
 */
export function LogsExplorerTab({ page, overview }: { page: LogsPage; overview: LogsOverview | undefined }) {
  const { t } = useLocale();
  const f = useFormat();
  const { refreshMs } = useLive();
  const { filters, range, explore, openLog, openTrace, navigate, logId } = page;
  const fixed = Boolean(filters.from || filters.to);
  const filterKey = JSON.stringify(filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const effective = useMemo<LogFilters>(() => (fixed ? filters : { ...filters, window: filters.window ?? range }), [filterKey, range, fixed]);
  const stream = useLogStream(effective, !fixed && refreshMs > 0);

  const [q, setQ] = useState(filters.q ?? '');
  const [module, setModule] = useState(filters.module ?? '');
  const [draft, setDraft] = useState<LogFilters>(filters);
  useEffect(() => {
    setQ(filters.q ?? '');
    setModule(filters.module ?? '');
    setDraft(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const apply = (next: LogFilters) => explore(clean(next));
  const exporter = useAppMutation<ExportFormat, number>({
    mutationFn: (format) => logsApi.exportFile(effective, format, EXPORT_LIMIT),
    success: (count) => t('logs.export.done', { count: f.compact(count) }),
  });

  const railCounts = Object.keys(filters).every((k) => RAIL_SAFE_KEYS.has(k)) && (filters.window ?? range) === range && !fixed ? (overview?.levels ?? null) : null;
  const chips = FILTER_KEYS.filter((k) => filters[k]);
  const meta = stream.meta;
  const resolved = meta?.resolved;
  const oldest = meta?.coverage.filter((c) => c.oldestAt).map((c) => `${c.runtime} ${logTime(c.oldestAt!)}`) ?? [];
  const exportCount = Math.min(meta?.matched ?? 0, EXPORT_LIMIT);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-18 lg:self-start">
        <LevelRail
          value={filters.level}
          onChange={(level) => apply({ ...filters, level })}
          levels={railCounts}
          hint={railCounts ? t('logs.page.levelsHint', { range: t(`ui.time.ranges.${range}`) }) : t('logs.page.countsHidden')}
        />
      </div>

      <div className="min-w-0">
        <form
          className="mb-1.5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply({ ...filters, q: q.trim() || undefined });
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('logs.explorer.placeholder')} aria-label={t('logs.explorer.placeholder')} spellCheck={false} className="h-9 pl-8 font-mono" />
          </div>
          <Button type="submit" variant="primary" className="h-9">
            {t('logs.explorer.search')}
          </Button>
        </form>
        <p className="mb-3 text-xs text-faint">{t('logs.explorer.syntax')}</p>

        <FilterBar active={chips.length > 0} onClear={() => explore({})}>
          <Select value={filters.runtime ?? ALL} onValueChange={(v) => apply({ ...filters, runtime: v === ALL ? undefined : v })}>
            <SelectTrigger size="sm" className="w-40" aria-label={t('logs.filter.runtime')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t('logs.filter.runtime')}: {t('logs.filter.all')}
              </SelectItem>
              {RUNTIMES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`rt.name.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={module}
            onChange={(e) => setModule(e.target.value)}
            onBlur={() => module !== (filters.module ?? '') && apply({ ...filters, module: module || undefined })}
            onKeyDown={(e) => e.key === 'Enter' && apply({ ...filters, module: module || undefined })}
            placeholder={`${t('logs.filter.module')}…`}
            aria-label={t('logs.filter.module')}
            className="h-7 w-40"
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm">
                <Filter />
                {t('logs.filter.more')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96">
              <form
                className="grid grid-cols-2 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  apply({ ...draft, q: q.trim() || undefined, module: module || undefined });
                }}
              >
                {MORE_FILTER_KEYS.map((k) => (
                  <label key={k} className="flex flex-col gap-1 text-xs text-muted">
                    {t(`logs.filter.${k}`)}
                    <Input value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value || undefined })} spellCheck={false} className="h-7 font-mono" />
                  </label>
                ))}
                <label className="flex flex-col gap-1 text-xs text-muted">
                  {t('logs.filter.from')}
                  <Input type="datetime-local" value={toLocalInput(draft.from)} onChange={(e) => setDraft({ ...draft, from: fromLocalInput(e.target.value) })} className="h-7" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  {t('logs.filter.to')}
                  <Input type="datetime-local" value={toLocalInput(draft.to)} onChange={(e) => setDraft({ ...draft, to: fromLocalInput(e.target.value) })} className="h-7" />
                </label>
                <div className="col-span-2 flex items-center justify-between gap-2 pt-1">
                  <span className="text-2xs text-faint">{t('logs.filter.timezone', { tz: browserTimeZone() })}</span>
                  <Button type="submit" size="sm" variant="primary">
                    {t('logs.filter.apply')}
                  </Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
          {chips.map((k) => (
            <Badge key={k} className="h-7 gap-1.5 pr-1">
              <span className="text-muted">{t(`logs.filter.${k}`)}:</span>
              <span className="max-w-48 truncate font-mono text-fg">{k === 'from' || k === 'to' ? new Date(filters[k]!).toLocaleString() : filters[k]}</span>
              <button type="button" onClick={() => apply({ ...filters, [k]: undefined })} className="rounded-sm p-0.5 text-faint hover:text-fg" aria-label={t('ui.action.clear')}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </FilterBar>

        {resolved && resolved.kinds.length > 0 && (
          <StatusBanner
            tone="info"
            title={t('logs.explorer.resolved', { id: resolved.id })}
            actions={
              <>
                {resolved.kinds.includes('job') && (
                  <Button size="xs" onClick={() => navigate(contextPath('job', resolved.id, resolved.queue))}>
                    <Briefcase />
                    {t('logs.detail.openJob')}
                  </Button>
                )}
                {resolved.kinds.includes('request') && (
                  <Button size="xs" onClick={() => navigate(contextPath('request', resolved.id))}>
                    <Globe />
                    {t('logs.detail.openRequest')}
                  </Button>
                )}
                {resolved.kinds.includes('execution') && (
                  <Button size="xs" onClick={() => navigate(contextPath('execution', resolved.id))}>
                    <CalendarClock />
                    {t('logs.detail.openExecution')}
                  </Button>
                )}
                <Button size="xs" variant="primary" onClick={() => openTrace(resolved.id)}>
                  <GitBranch />
                  {t('logs.detail.viewTrace')}
                </Button>
              </>
            }
          />
        )}

        <Panel
          flush
          title={
            meta
              ? t('logs.explorer.summary', { shown: f.compact(stream.rows.length), matched: f.compact(meta.matched), scanned: f.compact(meta.scanned) })
              : t('nav.logs')
          }
          hint={`${stream.live ? `${t('logs.page.liveHint', { sec: LIVE_POLL_MS / 1000 })} · ` : ''}${t('logs.filter.timezone', { tz: browserTimeZone() })}`}
          actions={
            <>
              <Hint content={fixed ? t('logs.live.fixed') : undefined}>
                <span>
                  <Button size="sm" variant={stream.live ? 'primary' : 'secondary'} onClick={() => stream.setLive(!stream.live)} disabled={fixed} aria-pressed={stream.live}>
                    <Radio />
                    {stream.live ? t('logs.live.on') : t('logs.live.off')}
                  </Button>
                </span>
              </Hint>
              {stream.live && (
                <Button size="sm" onClick={stream.paused ? stream.resume : stream.pause}>
                  {stream.paused ? <Play /> : <Pause />}
                  {stream.paused ? t('logs.live.resume') : t('logs.live.pause')}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" disabled={!exportCount || exporter.isPending}>
                    <Download />
                    {t('logs.export.button', { count: f.compact(exportCount) })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t('logs.export.format')}</DropdownMenuLabel>
                  {EXPORT_FORMATS.map((fmt) => (
                    <DropdownMenuItem key={fmt} onSelect={() => exporter.mutate(fmt)}>
                      {t('logs.page.exportAs', { format: fmt.toUpperCase() })}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        >
          {stream.paused && (stream.pendingCount > 0 || stream.pendingMore) && (
            <div className="flex items-center justify-between gap-2 border-b border-info-border bg-info-bg px-3 py-2 text-sm text-info-fg">
              <span className="flex items-center gap-2">
                <Pause className="size-3.5" />
                {t('logs.live.pending', { count: `${stream.pendingCount}${stream.pendingMore ? '+' : ''}` })}
              </span>
              <Button size="xs" variant="primary" onClick={stream.resume}>
                <ArrowDownToLine />
                {t('logs.live.jump')}
              </Button>
            </div>
          )}
          {stream.first.data === undefined ? (
            <PanelState
              status={stream.first.isError ? 'error' : 'loading'}
              error={stream.first.error}
              onRetry={() => void stream.first.refetch()}
              className="p-3"
            />
          ) : (
            <LogTable
              rows={stream.rows}
              onOpen={openLog}
              activeId={logId}
              freshIds={stream.fresh}
              maxHeight={LOG_TABLE_HEIGHT_PX}
              emptyMessage={`${t('logs.empty.text')} ${t('logs.empty.tip1')} · ${t('logs.empty.tip2')}`}
              loadMore={{ hasMore: stream.hasOlder, loading: stream.loadingOlder, onLoadMore: () => void stream.loadOlder() }}
              footer={
                !stream.hasOlder && stream.rows.length > 0 && oldest.length > 0
                  ? t('logs.explorer.coverage', { oldest: oldest.join(' · '), count: f.compact(meta?.coverage[0]?.capacity ?? 0) })
                  : stream.live
                    ? t('logs.explorer.rolling', { size: f.compact(DEFAULT_LIVE_BUFFER) })
                    : null
              }
            />
          )}
        </Panel>
        {stream.olderError ? <PanelState status="error" error={stream.olderError} compact /> : null}
      </div>
    </div>
  );
}

