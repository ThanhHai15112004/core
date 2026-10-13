import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useTicker } from '@core/hooks/useTicker';
import { AlertList, DataTable } from '@core/ui/blocks';
import type { Concentration, Upcoming } from '../../types/scheduler.types';
import { COUNTDOWN_TICK_MS } from '../../constants/scheduler';
import { formatDateTime, formatIn, secondsUntil } from '../../utils/scheduler-format';

const col = createColumnHelper<Upcoming>();

/** Sắp chạy gì, bao lâu nữa — không cần tự đọc biểu thức cron. */
export function UpcomingTable({
  items,
  onOpenTask,
  showTime = false,
  maxHeight,
  footer,
}: {
  items: Upcoming[];
  onOpenTask: (taskId: string) => void;
  showTime?: boolean;
  maxHeight?: number;
  footer?: React.ReactNode;
}) {
  const { t, locale } = useLocale();
  const now = useTicker(COUNTDOWN_TICK_MS);
  const columns = useMemo(
    () => [
      col.accessor('at', { id: 'in', header: t('sch.upcoming.in'), cell: (c) => formatIn(secondsUntil(c.getValue(), now)), meta: { mono: true, width: '84px' } }),
      ...(showTime ? [col.accessor('at', { id: 'at', header: t('sch.upcoming.at'), cell: (c) => formatDateTime(c.getValue(), locale, false), meta: { mono: true, width: '110px' } })] : []),
      col.accessor('taskName', { header: t('sch.task.name'), cell: (c) => <span className="text-fg">{c.getValue()}</span>, meta: { truncate: true } }),
      col.accessor('description', {
        header: t('sch.task.schedule'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate">{c.getValue()}</div>
            {c.row.original.expression && <div className="truncate font-mono text-2xs text-faint">{c.row.original.expression}</div>}
          </div>
        ),
      }),
    ],
    [t, locale, now, showTime],
  );
  return (
    <DataTable
      data={items}
      columns={columns}
      getRowId={(u) => `${u.taskId}-${u.at}`}
      onRowClick={(u) => onOpenTask(u.taskId)}
      emptyMessage={t('sch.upcoming.empty')}
      maxHeight={maxHeight}
      virtual={maxHeight !== undefined}
      footer={footer}
    />
  );
}

/** Nhiều task dồn vào cùng cửa sổ 5 phút — chỉ giúp nhìn thấy, không tự sửa lịch. */
export function ConcentrationList({ items, className }: { items: Concentration[]; className?: string }) {
  const { t, formatTime } = useLocale();
  if (items.length === 0) return null;
  return (
    <AlertList
      className={className}
      items={items.map((c) => ({
        id: c.from,
        tone: 'warn',
        title: t('sch.concentration.title', { count: c.count }),
        detail: `${t('sch.concentration.window', { from: formatTime(c.from), to: formatTime(c.to) })} · ${c.tasks.join(', ')}`,
      }))}
    />
  );
}
