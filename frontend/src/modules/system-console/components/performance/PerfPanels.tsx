import { ArrowRight, Check, Minus, X } from 'lucide-react';
import { cn } from '@core/lib/cn';
import { useLocale } from '@core/i18n/index';
import { NO_VALUE } from '@core/lib/format';
import { TONE_CLASS } from '@core/theme';
import { PanelState, UsageBar } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { Breakdown, Budget, Capacity, Throughput } from '../../types/performance.types';
import { CAPACITY_FULL_PERCENT, CAPACITY_WARN_PERCENT } from '../../constants/performance';
import { usePerfFormat } from './perf-format';

/** Thời gian trung bình một request chia theo giai đoạn thật của Fastify/Nest (DB/cache đo trong cùng request). */
export function LatencyBreakdown({ breakdown, dbActive }: { breakdown: Breakdown; dbActive: boolean }) {
  const { t } = useLocale();
  const fmt = usePerfFormat();
  if (breakdown.avgTotalMs === null) return <PanelState status="empty" message={t('perf.breakdown.empty')} compact />;
  const top = breakdown.phases.reduce((a, b) => (b.avgMs > a.avgMs ? b : a), breakdown.phases[0]!);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-xl font-semibold tabular-nums text-fg">{fmt(breakdown.avgTotalMs, 'ms')}</span>
        <span className="text-xs text-muted">{t('perf.breakdown.requests', { count: breakdown.requests })}</span>
        <span className="text-xs text-muted">
          {dbActive ? t('perf.breakdown.dbQueries', { count: breakdown.dbQueriesPerRequest ?? NO_VALUE }) : t('perf.breakdown.dbInactive')}
        </span>
      </div>
      <BarList
        items={breakdown.phases.map((p) => ({
          id: p.phase,
          label: t(`perf.breakdown.phase.${p.phase}`),
          value: p.avgMs,
          display: `${fmt(p.avgMs, 'ms')} · ${p.percent}%`,
          tone: p.phase === top.phase && p.avgMs > 0 ? 'warn' : undefined,
        }))}
      />
    </>
  );
}

const FLOW: { key: keyof Throughput; unit: string }[] = [
  { key: 'httpPerSec', unit: '/s' },
  { key: 'dbQueriesPerSec', unit: '/s' },
  { key: 'cacheOpsPerSec', unit: '/s' },
  { key: 'messagesPerMin', unit: '/min' },
  { key: 'jobsPerMin', unit: '/min' },
];

/** Luồng công việc qua hệ thống — HTTP tăng mà worker không tăng theo thì queue sẽ dồn. */
export function ThroughputFlow({ throughput: tp }: { throughput: Throughput }) {
  const { t } = useLocale();
  const fmt = usePerfFormat();
  return (
    <>
      <ol className="flex flex-wrap items-center gap-2">
        {FLOW.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <div className="rounded-md border border-border bg-panel-2 px-3 py-2">
              <div className="text-2xs text-muted">{t(`perf.throughput.${s.key}`)}</div>
              <div className="font-mono text-sm font-semibold tabular-nums text-fg">{fmt(tp[s.key], s.unit)}</div>
            </div>
            {i < FLOW.length - 1 && <ArrowRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <div className="mt-3 text-xs text-muted">
        {t('perf.throughput.queueWaiting')}: <span className="font-mono tabular-nums text-fg">{fmt(tp.queueWaiting, 'jobs')}</span>
      </div>
    </>
  );
}

/** Mục tiêu hiệu năng (✓ / ✕ so với target cấu hình). */
export function BudgetList({ budgets }: { budgets: Budget[] }) {
  const { t } = useLocale();
  const fmt = usePerfFormat();
  return (
    <ul className="flex flex-col divide-y divide-border">
      {budgets.map((b) => {
        const tone = b.met === null ? 'unknown' : b.met ? 'ok' : 'crit';
        const Icon = b.met === null ? Minus : b.met ? Check : X;
        return (
          <li key={b.key} className="flex items-center gap-2.5 py-2">
            <Icon className={cn('size-4 shrink-0', TONE_CLASS[tone].fg)} aria-label={b.met === null ? t('perf.budgets.noData') : b.met ? t('perf.budgets.met') : t('perf.budgets.exceeded')} />
            <span className="min-w-0 flex-1 truncate text-sm text-fg-2">{t(`perf.budgets.${b.key}`)}</span>
            <span className={cn('font-mono text-sm tabular-nums', TONE_CLASS[tone].fg)}>{fmt(b.current, b.unit)}</span>
            <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-faint">{t('perf.budgets.target', { value: fmt(b.target, b.unit) })}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** MB giữ nguyên; đơn vị đếm khác (kết nối, slot) → số trần. */
const countUnit = (unit: string) => (unit === 'MB' ? unit : 'jobs');

/** Mức sử dụng tài nguyên có giới hạn thật (CPU, RAM, pool DB, concurrency worker). */
export function CapacityList({ capacity }: { capacity: Capacity[] }) {
  const { t } = useLocale();
  const fmt = usePerfFormat();
  return (
    <ul className="flex flex-col gap-3">
      {capacity.map((c) => (
        <li key={c.key}>
          <div className="mb-1 flex items-baseline gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-fg-2">
              {t(`perf.capacity.${c.key}`)}
              {c.runtime && (c.key === 'memory' || c.key === 'cpu') && <span className="text-faint"> · {t(`rt.name.${c.runtime}`)}</span>}
            </span>
            {c.unit !== '%' && c.percent !== null && (
              <span className="font-mono tabular-nums text-faint">
                {fmt(c.used, countUnit(c.unit))} / {fmt(c.limit, countUnit(c.unit))}
              </span>
            )}
          </div>
          <UsageBar percent={c.percent} thresholds={{ warn: CAPACITY_WARN_PERCENT, crit: CAPACITY_FULL_PERCENT }} />
        </li>
      ))}
    </ul>
  );
}
