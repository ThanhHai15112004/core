import { Fragment, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, GitBranch, Search, XCircle } from 'lucide-react';
import { cn } from '@core/lib/cn';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button, Hint, Input } from '@core/ui/primitives';
import { KeyValueGrid, Panel, QueryView, RelativeTime, StatGrid, StatTile, StatusBanner } from '@core/ui/blocks';
import type { LogRow, TraceEvent } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { contextPath, logTime } from '../../utils/logs-format';
import { logsKeys } from './logs-keys';
import type { LogsPage } from './useLogsPage';

const RECENT_FAILING_SIZE = 12;
const linkPath = (l: NonNullable<TraceEvent['link']>) => contextPath(l.kind, l.id, l.queue);
const TRACE_TONE = { failed: 'crit', running: 'warn', ok: 'ok', unknown: 'unknown' } as const;
const EVENT_DOT = { error: 'bg-crit', warn: 'bg-warn', info: 'bg-info' } as const;

/**
 * Trace / correlation: dán request / job / execution / correlation ID → mọi sự kiện cùng chuỗi xử lý theo thời gian,
 * luồng thành phần và điểm lỗi đầu tiên (không gọi là nguyên nhân gốc).
 */
export function LogsTracePage({ page }: { page: LogsPage }) {
  const { t } = useLocale();
  const id = page.traceId;
  const [input, setInput] = useState(id ?? '');

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => page.go('overview')}>
        <ArrowLeft />
        {t('nav.logs')}
      </Button>
      <Panel className="mb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) page.openTrace(input.trim());
          }}
        >
          <div className="relative min-w-0 flex-1">
            <GitBranch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('logs.trace.placeholder')} aria-label={t('logs.trace.placeholder')} spellCheck={false} className="h-9 pl-8 font-mono" />
          </div>
          <Button type="submit" variant="primary" className="h-9">
            <Search />
            {t('logs.trace.open')}
          </Button>
        </form>
        <p className="mt-1.5 text-xs text-faint">{t('logs.trace.hint')}</p>
      </Panel>
      {id ? <TraceView id={id} page={page} /> : <RecentFailing page={page} />}
    </>
  );
}

function RecentFailing({ page }: { page: LogsPage }) {
  const { t } = useLocale();
  const query = useLiveQuery(logsKeys.recentFailing(), () => logsApi.search({ level: 'error,fatal', window: '24h' }, null, 200), { tier: 'slow' });
  /** Mỗi chuỗi (correlation / request / job) một dòng. */
  const failing = useMemo(() => {
    const seen = new Map<string, LogRow>();
    for (const r of query.data?.items ?? []) {
      const key = r.correlationId ?? r.requestId ?? r.jobId;
      if (key && !seen.has(key)) seen.set(key, r);
    }
    return [...seen.entries()].slice(0, RECENT_FAILING_SIZE);
  }, [query.data]);
  return (
    <Panel title={t('logs.trace.recentFailing')} description={t('logs.window.24h')}>
      <QueryView query={query} isEmpty={() => failing.length === 0} emptyMessage={t('logs.trace.noneFailing')}>
        {() => (
          <ul className="flex flex-col divide-y divide-border">
            {failing.map(([key, r]) => (
              <li key={key}>
                <button type="button" onClick={() => page.openTrace(key)} className="flex w-full items-baseline gap-3 px-1 py-2 text-left hover:bg-panel-2">
                  <span className="w-44 shrink-0 truncate font-mono text-xs text-info-fg">{key}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg-2">{r.message}</span>
                  <span className="shrink-0 text-xs text-faint">
                    {r.runtime} · <RelativeTime value={r.at} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

function TraceView({ id, page }: { id: string; page: LogsPage }) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(logsKeys.trace(id), () => logsApi.trace(id), { tier: 'static', keepPrevious: false });
  const componentLabel = (c: string) => {
    const k = `logs.component.${c}`;
    const v = t(k);
    return v === k ? c : v;
  };
  return (
    <QueryView query={query}>
      {(d) => (
        <>
          <Panel
            className="mb-4"
            title={
              <span className="flex items-center gap-2">
                {t('logs.trace.title')} <span className="font-mono text-xs font-normal text-fg-2">{d.correlationId ?? d.id}</span>
              </span>
            }
            description={t('logs.trace.resolved', { kinds: d.resolvedFrom.map((k) => t(`logs.ctx.${k}`)).join(', ') || NO_VALUE })}
          >
            <StatGrid columns={6} className="mb-3">
              <StatTile label={t('logs.trace.title')} value={t(`logs.trace.status.${d.status}`)} tone={TRACE_TONE[d.status]} />
              <StatTile label={t('logs.trace.duration')} value={f.duration(d.durationMs)} />
              <StatTile label={t('logs.trace.services')} value={String(d.services.length)} sub={d.services.join(', ')} />
              <StatTile label={t('logs.trace.logs')} value={f.compact(d.counts.logs)} />
              <StatTile label={t('logs.trace.errors')} value={f.compact(d.counts.errors)} tone={d.counts.errors ? 'crit' : 'ok'} />
              <StatTile label={`${t('logs.trace.jobs')} / ${t('logs.trace.requests')}`} value={`${d.counts.jobs} / ${d.counts.requests}`} />
            </StatGrid>
            <KeyValueGrid
              items={[
                ...(d.root ? [{ label: t('logs.trace.root'), value: `${d.root.label} · ${logTime(d.root.at)}` }] : []),
                ...(d.failurePoint
                  ? [
                      {
                        label: t('logs.trace.failurePoint'),
                        hint: t('logs.trace.failureNote'),
                        value: (
                          <span className="flex flex-wrap items-center gap-2">
                            <XCircle className="size-3.5 text-crit" />
                            <span className="font-medium text-crit-fg">{d.failurePoint.errorType ?? d.failurePoint.label}</span>
                            <span className="text-muted">{d.failurePoint.component}</span>
                            {d.failurePoint.logId && (
                              <Button size="xs" variant="link" onClick={() => page.openLog(d.failurePoint!.logId!)}>
                                {t('logs.trace.openLog')}
                              </Button>
                            )}
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Panel>
          {d.truncated && <StatusBanner tone="warn" title={t('logs.trace.truncated')} />}

          <Panel title={t('logs.trace.flow')} className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              {d.flow.map((n, i) => (
                <Fragment key={`${n.component}-${n.label}-${i}`}>
                  {i > 0 && <ArrowRight className="size-4 shrink-0 text-faint" />}
                  <Hint content={`${n.events} · ${formatTime(n.firstAt, true)}`}>
                    <button
                      type="button"
                      disabled={!n.link}
                      onClick={() => n.link && page.navigate(linkPath(n.link))}
                      className={cn(
                        'flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left',
                        n.status === 'error' ? 'border-crit-border bg-crit-bg' : 'border-border bg-panel-2',
                        n.link && 'hover:border-border-strong',
                      )}
                    >
                      <span className="text-2xs uppercase tracking-wide text-muted">{componentLabel(n.component)}</span>
                      <span className={cn('text-sm', n.status === 'error' ? 'text-crit-fg' : 'text-fg')}>{n.label}</span>
                    </button>
                  </Hint>
                </Fragment>
              ))}
            </div>
          </Panel>

          <Panel title={t('logs.trace.timeline')} description={t('logs.trace.events', { count: d.events.length })} flush>
            <ol className="flex flex-col">
              {d.events.map((e, i) => (
                <li key={i} className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0">
                  <span className="w-24 shrink-0 font-mono text-xs text-muted">{logTime(e.at)}</span>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', EVENT_DOT[e.level])} aria-hidden="true" />
                  <span className="w-20 shrink-0 truncate text-xs text-fg-2">{componentLabel(e.component)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-sm text-fg">
                      {e.module && <span className="mr-1.5 font-mono text-xs text-muted">[{e.module}]</span>}
                      {e.label}
                    </div>
                    {e.detail && <div className="break-words text-xs text-muted">{e.detail}</div>}
                  </div>
                  <span className="flex shrink-0 gap-1">
                    {e.logId && (
                      <Button size="xs" variant="ghost" onClick={() => page.openLog(e.logId!)}>
                        {t('logs.trace.openLog')}
                      </Button>
                    )}
                    {e.link && (
                      <Button size="xs" variant="ghost" onClick={() => page.navigate(linkPath(e.link!))}>
                        {t(`logs.trace.open_${e.link.kind}`)}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </>
      )}
    </QueryView>
  );
}
