import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { OctagonX, Unplug } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import type { Tone } from '@core/theme';
import { Badge, Button, Hint } from '@core/ui/primitives';
import { DataTable, StatusDot } from '@core/ui/blocks';
import type { DbSession } from '../../types/database.types';
import { SESSION_TONE } from '../../constants/database';
import { sessionSource } from './db-labels';

interface SessionTableProps {
  sessions: DbSession[];
  /** Ngưỡng chậm (ms); null = không đánh dấu. */
  slowMs: number | null;
  actionsEnabled: boolean;
  canCancel: boolean;
  canTerminate: boolean;
  onOpen: (s: DbSession) => void;
  onCancel?: (s: DbSession) => void;
  onTerminate?: (s: DbSession) => void;
  activeId?: string | null;
  emptyMessage: string;
  maxHeight?: number;
}

const col = createColumnHelper<DbSession>();
const isSlow = (s: DbSession, slowMs: number | null) => slowMs !== null && s.state === 'active' && (s.queryMs ?? 0) >= slowMs;

/** Bảng session / query đang chạy: nguồn, trạng thái, thời gian, SQL đã bỏ literal + Huỷ query / Ngắt session. */
export function SessionTable({ sessions, slowMs, actionsEnabled, canCancel, canTerminate, onOpen, onCancel, onTerminate, activeId, emptyMessage, maxHeight }: SessionTableProps) {
  const { t } = useLocale();
  const f = useFormat();
  const toneOf = (s: DbSession): Tone => (isSlow(s, slowMs) ? 'warn' : SESSION_TONE[s.state]);

  const columns = useMemo(
    () => [
      col.accessor('id', {
        header: t('db.session.id'),
        cell: (c) => (
          <span className="flex flex-col">
            <span className="font-mono text-xs text-fg">#{c.getValue()}</span>
            {c.row.original.isSelf && <span className="text-2xs text-faint">{t('db.session.console')}</span>}
          </span>
        ),
        meta: { width: '120px' },
      }),
      col.accessor((s) => sessionSource(s, t), { id: 'source', header: t('db.session.source'), meta: { width: '130px', truncate: true } }),
      col.accessor('state', {
        header: t('db.session.state'),
        cell: (c) => {
          const s = c.row.original;
          const tone = toneOf(s);
          return (
            <span className="flex flex-col items-start gap-0.5">
              <Badge tone={tone} size="xs">
                <StatusDot tone={tone} size="xs" />
                {isSlow(s, slowMs) ? t('db.session.slow') : t(`db.session.status.${s.state}`)}
              </Badge>
              {s.blockedBy.length > 0 && <span className="text-2xs text-crit-fg">{t('db.session.blockedBy', { ids: s.blockedBy.map((b) => `#${b}`).join(', ') })}</span>}
            </span>
          );
        },
        meta: { width: '150px' },
      }),
      col.accessor('queryMs', { header: t('db.session.age'), cell: (c) => f.duration(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
      col.accessor('query', {
        header: t('db.session.query'),
        enableSorting: false,
        cell: (c) =>
          c.row.original.isSelf ? (
            <span className="text-xs text-faint">{t('db.session.consoleQuery')}</span>
          ) : (
            <span className="font-mono text-xs text-fg-2">{c.getValue() ?? NO_VALUE}</span>
          ),
        meta: { truncate: true },
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">{t('db.session.actions')}</span>,
        cell: (c) => {
          const s = c.row.original;
          if (s.isSelf) return null;
          const hint = (label: string) => (actionsEnabled ? label : t('db.action.disabled'));
          return (
            <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {canCancel && s.query && onCancel && (
                <Hint content={hint(t('db.action.cancel'))}>
                  <span>
                    <Button variant="ghost" size="icon-xs" disabled={!actionsEnabled} aria-label={t('db.action.cancel')} onClick={() => onCancel(s)}>
                      <OctagonX />
                    </Button>
                  </span>
                </Hint>
              )}
              {canTerminate && onTerminate && (
                <Hint content={hint(t('db.action.terminate'))}>
                  <span>
                    <Button variant="ghost" size="icon-xs" className="text-crit-fg" disabled={!actionsEnabled} aria-label={t('db.action.terminate')} onClick={() => onTerminate(s)}>
                      <Unplug />
                    </Button>
                  </span>
                </Hint>
              )}
            </span>
          );
        },
        meta: { width: '72px', align: 'right' },
      }),
    ],
    [t, f, slowMs, actionsEnabled, canCancel, canTerminate, onCancel, onTerminate], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <DataTable
      data={sessions}
      columns={columns}
      getRowId={(s) => s.id}
      onRowClick={onOpen}
      activeRowId={activeId}
      rowTone={(s) => (toneOf(s) === 'ok' ? undefined : toneOf(s))}
      initialSorting={[{ id: 'queryMs', desc: true }]}
      emptyMessage={emptyMessage}
      maxHeight={maxHeight}
    />
  );
}
