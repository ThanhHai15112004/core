import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Sparkles } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import { DataTable, RelativeTime } from '@core/ui/blocks';
import { Sparkline } from '@core/ui/charts';
import type { ErrorGroupRow } from '../../types/logs.types';

const col = createColumnHelper<ErrorGroupRow>();

/** Xu hướng của nhóm lỗi: mới / tăng / giảm / ổn định (+ spike). */
export function TrendBadge({ g }: { g: ErrorGroupRow }) {
  const { t } = useLocale();
  if (g.trend === 'new' || g.isNew)
    return (
      <Badge tone="warn">
        <Sparkles />
        {t('logs.trend.new')}
      </Badge>
    );
  const Icon = g.trend === 'up' ? ArrowUpRight : g.trend === 'down' ? ArrowDownRight : ArrowRight;
  const tone = g.spiking || g.trend === 'up' ? 'crit' : g.trend === 'down' ? 'ok' : 'unknown';
  return (
    <Badge tone={tone}>
      <Icon />
      {g.changePercent !== null && g.trend !== 'flat' ? `${g.changePercent > 0 ? '+' : ''}${g.changePercent}%` : t(`logs.trend.${g.trend}`)}
      {g.spiking && ` · ${t('logs.trend.spike')}`}
    </Badge>
  );
}

/** Nhóm lỗi: gom nhiều log cùng lỗi thành một dòng — số lần, lần cuối, xu hướng, nơi bị ảnh hưởng. */
export function ErrorGroupTable({ rows, onOpen, compact }: { rows: ErrorGroupRow[]; onOpen: (fp: string) => void; compact?: boolean }) {
  const { t, formatRelative } = useLocale();
  const f = useFormat();
  const columns = useMemo(
    () => [
      col.accessor('template', {
        header: t('logs.groups.error'),
        cell: (c) => {
          const g = c.row.original;
          return (
            <div className="min-w-0">
              <div className="truncate font-medium text-fg">{g.errorType ?? t('logs.groups.untyped')}</div>
              <div className="line-clamp-2 break-words text-xs text-fg-2" title={g.template}>
                {g.template}
              </div>
              {g.module && (
                <div className="truncate font-mono text-2xs text-faint">
                  {g.module}
                  {g.frame ? ` · ${g.frame}` : ''}
                </div>
              )}
            </div>
          );
        },
        enableSorting: false,
      }),
      col.accessor('count', {
        header: t('logs.groups.count'),
        cell: (c) => (
          <div>
            <div className="font-semibold text-fg">{f.compact(c.getValue())}</div>
            {c.row.original.total > c.getValue() && <div className="text-2xs text-faint">{t('logs.groups.total', { count: f.compact(c.row.original.total) })}</div>}
          </div>
        ),
        meta: { align: 'right', mono: true, width: '100px' },
      }),
      col.accessor((g) => (g.lastSeen ? Date.parse(g.lastSeen) : 0), {
        id: 'lastSeen',
        header: t('logs.groups.lastSeen'),
        cell: (c) => (
          <div className="text-xs">
            <RelativeTime value={c.row.original.lastSeen} className="text-fg-2" />
            {c.row.original.firstSeen && <div className="text-2xs text-faint">{t('logs.groups.firstSeen', { when: formatRelative(c.row.original.firstSeen) })}</div>}
          </div>
        ),
        meta: { width: '140px' },
      }),
      col.display({
        id: 'trend',
        header: t('logs.groups.trend'),
        cell: (c) => (
          <div className="flex items-center gap-2">
            <TrendBadge g={c.row.original} />
            {!compact && <Sparkline values={c.row.original.spark} tone="crit" className="w-16" />}
          </div>
        ),
        meta: { width: compact ? '130px' : '210px' },
      }),
      ...(compact
        ? []
        : [
            col.display({
              id: 'affected',
              header: t('logs.groups.affected'),
              cell: (c) => {
                const g = c.row.original;
                return (
                  <div className="flex flex-wrap gap-1">
                    {[...g.runtimes, ...g.jobTypes.slice(0, 2), ...g.routes.slice(0, 1)].map((x) => (
                      <Badge key={x} size="xs" className="max-w-40 truncate font-mono">
                        {x}
                      </Badge>
                    ))}
                  </div>
                );
              },
              meta: { width: '220px' },
            }),
          ]),
    ],
    [t, f, compact, formatRelative],
  );
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(g) => g.fingerprint}
      onRowClick={(g) => onOpen(g.fingerprint)}
      rowTone={(g) => (g.spiking ? 'crit' : g.isNew ? 'warn' : undefined)}
      initialSorting={[{ id: 'count', desc: true }]}
      emptyMessage={t('logs.groups.empty')}
    />
  );
}
