import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { TrendingUp } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { toneOf } from '@core/theme';
import { Hint } from '@core/ui/primitives';
import { DataTable, StatusDot, UsageBar } from '@core/ui/blocks';
import type { RuntimeResource } from '../../types/performance.types';
import { CAPACITY_FULL_PERCENT } from '../../constants/performance';
import { usePerfFormat } from './perf-format';

const col = createColumnHelper<RuntimeResource>();

interface ResourceTableProps {
  resources: RuntimeResource[];
  thresholds: { cpuPercent: number; memoryPercent: number };
  onOpen: (runtimeId: string) => void;
}

/** Tài nguyên theo runtime: CPU (hiện tại · TB · đỉnh), bộ nhớ so với giới hạn, event loop, GC. Bấm hàng → Runtimes. */
export function ResourceTable({ resources, thresholds, onOpen }: ResourceTableProps) {
  const { t } = useLocale();
  const f = useFormat();
  const fmt = usePerfFormat();
  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: t('perf.resources.runtime'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot tone={toneOf(r.status)} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate font-medium text-fg">
                  {r.name}
                  {r.memoryTrend?.growing && (
                    <Hint content={t('perf.resources.growth', { mb: f.number(r.memoryTrend.changeMb, 1), minutes: r.memoryTrend.windowMin })}>
                      <TrendingUp className="size-3.5 shrink-0 text-warn" aria-label={t('perf.resources.growthShort')} />
                    </Hint>
                  )}
                </div>
                <div className="text-2xs text-faint">{r.cpuPercent !== null ? t('perf.resources.instances', { count: r.instances }) : t('perf.resources.offline')}</div>
              </div>
            </div>
          );
        },
        meta: { width: '22%' },
      }),
      col.accessor('cpuPercent', {
        header: t('perf.resources.cpu'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <div className="min-w-32">
              <UsageBar percent={r.cpuPercent} thresholds={{ warn: thresholds.cpuPercent, crit: CAPACITY_FULL_PERCENT }} />
              <div className="mt-0.5 truncate font-mono text-2xs text-faint">
                {t('perf.resources.cpuStats', { avg: f.percent(r.cpuAvgPercent), peak: f.percent(r.cpuPeakPercent) })}
              </div>
            </div>
          );
        },
      }),
      col.accessor('memoryPercent', {
        header: t('perf.resources.memory'),
        cell: (c) => {
          const r = c.row.original;
          const used = r.memoryLimitSource === 'cgroup' ? r.rssMb : r.heapUsedMb;
          return (
            <Hint content={t('perf.resources.memoryStats', { rss: f.mb(r.rssMb), heap: f.mb(r.heapUsedMb), external: f.mb(r.externalMb) })}>
              <div className="min-w-32">
                <UsageBar percent={r.memoryPercent} thresholds={{ warn: thresholds.memoryPercent, crit: CAPACITY_FULL_PERCENT }} />
                <div className="mt-0.5 truncate font-mono text-2xs text-faint">
                  {f.mb(used)} / {f.mb(r.memoryLimitMb)}
                </div>
              </div>
            </Hint>
          );
        },
      }),
      col.accessor('eventLoopP99Ms', {
        header: t('perf.resources.eventLoop'),
        cell: (c) => (
          <div>
            <div className="text-fg">{fmt(c.getValue(), 'ms')}</div>
            <div className="text-2xs text-faint">{t('perf.resources.peak', { value: fmt(c.row.original.eventLoopPeakMs, 'ms') })}</div>
          </div>
        ),
        meta: { align: 'right', mono: true },
      }),
      col.accessor('gcPerMin', {
        header: t('perf.resources.gc'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <Hint content={t('perf.resources.gcPause', { pause: fmt(r.gcPauseMsPerMin, 'ms/min'), max: fmt(r.gcMaxPauseMs, 'ms') })}>
              <div>
                <div className="text-fg">{fmt(r.gcPerMin, '/min')}</div>
                <div className="text-2xs text-faint">{fmt(r.gcPauseMsPerMin, 'ms/min')}</div>
              </div>
            </Hint>
          );
        },
        meta: { align: 'right', mono: true },
      }),
    ],
    [t, f, fmt, thresholds],
  );
  return <DataTable data={resources} columns={columns} getRowId={(r) => r.id} onRowClick={(r) => onOpen(r.id)} rowTone={(r) => (r.memoryTrend?.growing ? 'warn' : undefined)} emptyMessage={t('perf.resources.empty')} />;
}
