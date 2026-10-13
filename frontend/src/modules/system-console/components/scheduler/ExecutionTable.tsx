import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { FileText } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button, Hint } from '@core/ui/primitives';
import { DataTable } from '@core/ui/blocks';
import type { Execution } from '../../types/scheduler.types';
import { EXECUTION_TONE } from '../../constants/scheduler';
import { execAt, execDurationMs, formatDateTime } from '../../utils/scheduler-format';
import { ExecStatusBadge } from './SchedulerBadges';

export type ExecColumn = 'time' | 'task' | 'result' | 'duration' | 'trigger' | 'error' | 'id' | 'logs';

const col = createColumnHelper<Execution>();
const atMs = (e: Execution) => {
  const at = execAt(e);
  return at ? Date.parse(at) : 0;
};

interface Props {
  rows: Execution[];
  columns: ExecColumn[];
  onOpen: (id: string) => void;
  activeId?: string | null;
  /** Cột `logs`: mở log theo correlation ID. */
  navigate?: (path: string) => void;
  emptyMessage?: string;
  maxHeight?: number;
  footer?: React.ReactNode;
}

/** Bảng lần chạy: thời điểm, task, kết quả, thời lượng, trigger, lỗi (bấm → drawer chi tiết). */
export function ExecutionTable({ rows, columns, onOpen, activeId, navigate, emptyMessage, maxHeight, footer }: Props) {
  const { t, locale } = useLocale();
  const f = useFormat();
  const defs = useMemo(() => {
    const all = {
      time: col.accessor(atMs, {
        id: 'time',
        header: t('sch.exec.col.time'),
        cell: (c) => {
          const at = execAt(c.row.original);
          return at ? formatDateTime(at, locale) : NO_VALUE;
        },
        meta: { mono: true, width: '130px' },
      }),
      task: col.accessor('taskName', { header: t('sch.exec.col.task'), cell: (c) => <span className="text-fg">{c.getValue()}</span>, meta: { truncate: true } }),
      result: col.accessor('status', { header: t('sch.exec.col.result'), cell: (c) => <ExecStatusBadge status={c.getValue()} />, meta: { width: '120px' } }),
      duration: col.accessor((e) => execDurationMs(e) ?? -1, {
        id: 'duration',
        header: t('sch.exec.col.duration'),
        cell: (c) => f.duration(execDurationMs(c.row.original)),
        meta: { mono: true, align: 'right', width: '96px' },
      }),
      trigger: col.accessor('trigger', { header: t('sch.exec.col.trigger'), cell: (c) => t(`sch.exec.trigger.${c.getValue()}`), meta: { width: '100px' } }),
      error: col.accessor((e) => e.error?.message ?? '', {
        id: 'error',
        header: t('sch.exec.col.error'),
        cell: (c) => {
          const err = c.row.original.error;
          return err ? (
            <span className="text-crit-fg" title={`${err.type}: ${err.message}`}>
              <span className="font-mono text-xs">{err.type}</span> {err.message}
            </span>
          ) : (
            <span className="text-faint">{NO_VALUE}</span>
          );
        },
        meta: { truncate: true },
      }),
      id: col.accessor('id', {
        header: t('sch.exec.col.id'),
        cell: (c) => <span title={c.getValue()}>{f.shortId(c.getValue(), 10, 0)}</span>,
        meta: { mono: true, width: '120px' },
      }),
      logs: col.display({
        id: 'logs',
        header: '',
        cell: (c) =>
          c.row.original.correlationId && navigate ? (
            <Hint content={t('sch.exec.openLogs')}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('sch.exec.openLogs')}
                onClick={(e) => (e.stopPropagation(), navigate(`logs/explorer?correlationId=${encodeURIComponent(c.row.original.correlationId)}`))}
              >
                <FileText />
              </Button>
            </Hint>
          ) : null,
        meta: { width: '44px', align: 'center' },
      }),
    };
    return columns.map((c) => all[c]);
  }, [columns, t, f, locale, navigate]);

  return (
    <DataTable
      data={rows}
      columns={defs}
      getRowId={(e) => e.id}
      onRowClick={(e) => onOpen(e.id)}
      activeRowId={activeId}
      rowTone={(e) => (e.status === 'failed' ? EXECUTION_TONE.failed : undefined)}
      initialSorting={columns.includes('time') ? [{ id: 'time', desc: true }] : []}
      emptyMessage={emptyMessage ?? t('sch.history.empty')}
      maxHeight={maxHeight}
      virtual={maxHeight !== undefined}
      footer={footer}
    />
  );
}
