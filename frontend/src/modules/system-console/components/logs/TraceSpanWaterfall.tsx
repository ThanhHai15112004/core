import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@core/lib/cn';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import { Panel } from '@core/ui/blocks';
import type { SpanCategory, TraceSpan } from '../../types/logs.types';

const CATEGORY_TONE: Record<SpanCategory, 'info' | 'warn' | 'ok' | 'unknown'> = {
  api: 'info',
  db: 'warn',
  http: 'info',
  job: 'ok',
  usecase: 'ok',
  internal: 'unknown',
};

const BAR_COLOR: Record<SpanCategory, string> = {
  api: 'bg-info',
  db: 'bg-warn',
  http: 'bg-info',
  job: 'bg-ok',
  usecase: 'bg-ok',
  internal: 'bg-faint',
};

interface SpanRow {
  span: TraceSpan;
  depth: number;
}

function buildSpanTreeRows(spans: readonly TraceSpan[]): SpanRow[] {
  const byId = new Map<string, TraceSpan>();
  const children = new Map<string, TraceSpan[]>();
  const roots: TraceSpan[] = [];

  for (const s of spans) {
    byId.set(s.spanId, s);
  }
  for (const s of spans) {
    if (s.parentSpanId && byId.has(s.parentSpanId)) {
      const list = children.get(s.parentSpanId);
      if (list) list.push(s);
      else children.set(s.parentSpanId, [s]);
    } else {
      roots.push(s);
    }
  }

  const sortByStart = (a: TraceSpan, b: TraceSpan) => a.startTimeMs - b.startTimeMs;
  roots.sort(sortByStart);
  for (const list of children.values()) list.sort(sortByStart);

  const rows: SpanRow[] = [];
  const visited = new Set<string>();
  const walk = (node: TraceSpan, depth: number) => {
    if (visited.has(node.spanId)) return;
    visited.add(node.spanId);
    rows.push({ span: node, depth });
    for (const child of children.get(node.spanId) ?? []) {
      walk(child, Math.min(depth + 1, 6));
    }
  };
  for (const r of roots) walk(r, 0);
  return rows;
}

/** Waterfall OpenTelemetry spans: cấu trúc cha-con, thanh thời gian tương đối và attribute chi tiết (đã lọc dữ liệu nhạy cảm). */
export function TraceSpanWaterfall({ spans }: { spans: readonly TraceSpan[] }) {
  const { t } = useLocale();
  const f = useFormat();
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => buildSpanTreeRows(spans), [spans]);
  const windowBounds = useMemo(() => {
    if (spans.length === 0) return { minStart: 0, totalMs: 1 };
    let minStart = spans[0]!.startTimeMs;
    let maxEnd = spans[0]!.endTimeMs;
    for (const s of spans) {
      if (s.startTimeMs < minStart) minStart = s.startTimeMs;
      if (s.endTimeMs > maxEnd) maxEnd = s.endTimeMs;
    }
    return { minStart, totalMs: Math.max(1, maxEnd - minStart) };
  }, [spans]);

  if (spans.length === 0) {
    return (
      <Panel title={t('logs.trace.waterfallTitle')} className="mb-4">
        <p className="text-xs text-muted">{t('logs.trace.noSpans')}</p>
      </Panel>
    );
  }

  return (
    <Panel title={`${t('logs.trace.waterfallTitle')} · ${t('logs.trace.spanCount', { count: spans.length })}`} className="mb-4" flush>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map(({ span, depth }) => {
          const isOpen = expanded === span.spanId;
          const isError = span.status === 'error';
          const leftPct = Math.max(0, Math.min(98, ((span.startTimeMs - windowBounds.minStart) / windowBounds.totalMs) * 100));
          const widthPct = Math.max(1.5, Math.min(100 - leftPct, (span.durationMs / windowBounds.totalMs) * 100));
          const attrEntries = Object.entries(span.attributes ?? {});

          return (
            <li key={span.spanId} className="flex flex-col">
              <button
                type="button"
                onClick={() => setExpanded((prev) => (prev === span.spanId ? null : span.spanId))}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-panel-2"
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5" style={{ paddingLeft: `${depth * 14}px` }}>
                  {isOpen ? <ChevronDown className="size-3.5 shrink-0 text-faint" /> : <ChevronRight className="size-3.5 shrink-0 text-faint" />}
                  <Badge size="xs" tone={isError ? 'crit' : CATEGORY_TONE[span.category]} className="shrink-0 uppercase">
                    {span.category}
                  </Badge>
                  <span className={cn('truncate font-mono text-xs', isError ? 'text-crit-fg' : 'text-fg')}>{span.name}</span>
                  <span className="shrink-0 text-2xs text-faint">({span.runtime})</span>
                </div>
                <div className="hidden w-48 shrink-0 sm:block">
                  <div className="relative h-2 w-full rounded-sm bg-panel-2">
                    <div
                      className={cn('absolute top-0 h-2 rounded-sm', isError ? 'bg-crit' : BAR_COLOR[span.category])}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    />
                  </div>
                </div>
                <span className="w-20 shrink-0 text-right font-mono text-xs text-muted">{f.duration(span.durationMs)}</span>
              </button>
              {isOpen && (
                <div className="border-t border-border bg-panel-2 px-4 py-2 text-xs">
                  <div className="mb-1 flex flex-wrap gap-3 font-mono text-2xs text-muted">
                    <span>spanId: {span.spanId}</span>
                    {span.parentSpanId && <span>parent: {span.parentSpanId}</span>}
                    <span>kind: {span.kind}</span>
                    <span>status: {span.status}</span>
                  </div>
                  {span.statusMessage && <div className="mb-1 text-crit-fg">{span.statusMessage}</div>}
                  {attrEntries.length > 0 && (
                    <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {attrEntries.map(([k, v]) => (
                        <div key={k} className="flex gap-1.5 font-mono text-2xs">
                          <dt className="shrink-0 text-muted">{k}:</dt>
                          <dd className="min-w-0 break-all text-fg-2">{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
