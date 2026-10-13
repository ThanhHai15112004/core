import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Play, Power, PowerOff } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { useTicker } from '@core/hooks/useTicker';
import { NO_VALUE } from '@core/lib/format';
import { cn } from '@core/lib/cn';
import { TONE_CLASS } from '@core/theme';
import { Button, Hint } from '@core/ui/primitives';
import { DataTable, RelativeTime } from '@core/ui/blocks';
import type { TaskRow } from '../../types/scheduler.types';
import { COUNTDOWN_TICK_MS, EXECUTION_TONE, SUCCESS_RATE_WARN_PERCENT } from '../../constants/scheduler';
import { formatIn, secondsUntil } from '../../utils/scheduler-format';
import type { TaskAction } from '../../sections/scheduler/useTaskActions';
import { ScheduleText, TaskHealthLabel, TaskStatusBadge } from './SchedulerBadges';

const col = createColumnHelper<TaskRow>();
const ts = (iso: string | null, empty: number) => (iso ? Date.parse(iso) : empty);

interface Props {
  rows: TaskRow[];
  onOpen: (id: string) => void;
  onAction?: (action: TaskAction, task: TaskRow) => void;
  canRun?: boolean;
  canToggle?: boolean;
  emptyMessage?: string;
}

/** Bảng task: lịch, lần chạy gần nhất + kết quả, lần tới, tỉ lệ thành công 24h, trạng thái + sức khoẻ, thao tác nhanh. */
export function TaskTable({ rows, onOpen, onAction, canRun = false, canToggle = false, emptyMessage }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const now = useTicker(COUNTDOWN_TICK_MS);
  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: t('sch.task.name'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{c.getValue()}</div>
            <div className="truncate font-mono text-2xs text-faint">
              {c.row.original.id}
              {c.row.original.type !== 'cron' && ` · ${t(`sch.type.${c.row.original.type}`)}`}
            </div>
          </div>
        ),
        meta: { width: '22%' },
      }),
      col.display({ id: 'schedule', header: t('sch.task.schedule'), cell: (c) => <ScheduleText schedule={c.row.original.schedule} /> }),
      col.accessor((x) => ts(x.lastRunAt, 0), {
        id: 'lastRun',
        header: t('sch.task.lastRun'),
        cell: (c) => {
          const x = c.row.original;
          if (!x.lastRunAt) return <span className="text-faint">{t('sch.task.never')}</span>;
          return (
            <div className="min-w-0">
              <RelativeTime value={x.lastRunAt} className="text-fg-2" />
              {x.lastStatus && (
                <div className={cn('truncate text-2xs', TONE_CLASS[EXECUTION_TONE[x.lastStatus]].fg)}>
                  {t(`sch.exec.status.${x.lastStatus}`)}
                  {x.lastDurationMs !== null && <span className="font-mono"> · {f.duration(x.lastDurationMs)}</span>}
                </div>
              )}
            </div>
          );
        },
      }),
      col.accessor((x) => ts(x.nextRunAt, Number.MAX_SAFE_INTEGER), {
        id: 'next',
        header: t('sch.task.nextRun'),
        cell: (c) => formatIn(secondsUntil(c.row.original.nextRunAt, now)),
        meta: { mono: true, align: 'right', width: '96px' },
      }),
      col.accessor((x) => x.successRatePercent ?? -1, {
        id: 'success',
        header: t('sch.task.success24h'),
        cell: (c) => {
          const x = c.row.original;
          const warn = x.successRatePercent !== null && x.successRatePercent < SUCCESS_RATE_WARN_PERCENT;
          return (
            <div>
              <div className={cn('font-mono text-xs tabular-nums', warn ? 'text-warn-fg' : 'text-fg-2')}>{x.successRatePercent === null ? NO_VALUE : f.percent(x.successRatePercent)}</div>
              {x.executions24h > 0 && <div className="text-2xs text-faint">{t('sch.task.runs', { count: f.compact(x.executions24h) })}</div>}
            </div>
          );
        },
        meta: { align: 'right', width: '120px' },
      }),
      col.accessor('status', {
        header: t('sch.task.status.label'),
        cell: (c) => (
          <div className="flex flex-col items-start gap-0.5">
            <TaskStatusBadge task={c.row.original} />
            <TaskHealthLabel health={c.row.original.health} />
          </div>
        ),
        meta: { width: '130px' },
      }),
      ...(onAction && (canRun || canToggle)
        ? [
            col.display({
              id: 'actions',
              header: '',
              cell: (c) => {
                const x = c.row.original;
                return (
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {canRun && (
                      <Button size="xs" onClick={() => onAction('run', x)}>
                        <Play />
                        {t('sch.action.run')}
                      </Button>
                    )}
                    {canToggle && (
                      <Hint content={t(`sch.action.${x.enabled ? 'disable' : 'enable'}`)}>
                        <Button size="icon-xs" variant="ghost" aria-label={t(`sch.action.${x.enabled ? 'disable' : 'enable'}`)} onClick={() => onAction(x.enabled ? 'disable' : 'enable', x)}>
                          {x.enabled ? <PowerOff /> : <Power />}
                        </Button>
                      </Hint>
                    )}
                  </div>
                );
              },
              meta: { width: '130px', align: 'right' },
            }),
          ]
        : []),
    ],
    [t, f, now, onAction, canRun, canToggle],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(x) => x.id}
      onRowClick={(x) => onOpen(x.id)}
      rowTone={(x) => (x.health === 'error' ? 'crit' : x.consecutiveFailures > 0 ? 'warn' : undefined)}
      initialSorting={[{ id: 'next', desc: false }]}
      emptyMessage={emptyMessage ?? t('sch.task.empty')}
    />
  );
}
