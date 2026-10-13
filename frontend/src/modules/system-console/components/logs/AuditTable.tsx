import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import { DataTable } from '@core/ui/blocks';
import type { AuditEvent } from '../../types/logs.types';
import { AUDIT_SECTION } from '../../constants/logs';

const col = createColumnHelper<AuditEvent>();

/** `retry_failed` → `Retry failed` khi chưa có bản dịch riêng. */
const humanize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

interface AuditTableProps {
  rows: AuditEvent[];
  navigate: (path: string) => void;
  compact?: boolean;
  loadMore?: { hasMore: boolean; loading?: boolean; onLoadMore: () => void };
  footer?: React.ReactNode;
}

/** Audit: ai đã làm gì, lúc nào, trên đối tượng nào, kết quả — chỉ xem. */
export function AuditTable({ rows, navigate, compact, loadMore, footer }: AuditTableProps) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const columns = useMemo(() => {
    const actionLabel = (e: AuditEvent) => {
      const key = `logs.audit.action.${e.domain}.${e.action}`;
      const v = t(key);
      return v === key ? humanize(e.action) : v;
    };
    return [
      col.accessor('at', {
        header: t('logs.audit.time'),
        cell: (c) => `${compact ? '' : `${new Date(c.getValue()).toLocaleDateString()} `}${formatTime(c.getValue(), true)}`,
        meta: { mono: true, width: compact ? '90px' : '170px' },
      }),
      col.accessor('actor', {
        header: t('logs.audit.actor'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate">{c.getValue() === 'system' ? t('logs.audit.system') : (c.getValue() ?? t('cache.ops.anonymous'))}</div>
            {!compact && c.row.original.ip && <div className="font-mono text-2xs text-faint">{c.row.original.ip}</div>}
          </div>
        ),
        meta: { width: compact ? '110px' : '160px' },
      }),
      col.display({
        id: 'action',
        header: t('logs.audit.actionCol'),
        cell: (c) => {
          const e = c.row.original;
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="xs" className="h-5 px-1" onClick={(ev) => (ev.stopPropagation(), navigate(AUDIT_SECTION[e.domain]))}>
                  <Badge size="xs">{t(`logs.audit.domain.${e.domain}`)}</Badge>
                </Button>
                <span className="truncate text-fg">{actionLabel(e)}</span>
              </div>
              {(compact ? e.target : e.detail) && <div className="truncate text-xs text-faint">{compact ? e.target : e.detail}</div>}
            </div>
          );
        },
      }),
      ...(compact
        ? []
        : [
            col.accessor('target', {
              header: t('logs.audit.target'),
              cell: (c) => c.getValue() ?? NO_VALUE,
              meta: { mono: true, truncate: true, width: '26%' },
            }),
          ]),
      col.accessor('result', {
        header: t('logs.audit.result'),
        cell: (c) => {
          const e = c.row.original;
          return (
            <div className="min-w-0">
              <Badge tone={e.result === 'success' ? 'ok' : 'crit'}>{t(`cache.ops.status.${e.result}`)}</Badge>
              {!compact && e.durationMs !== null && <span className="ml-1.5 font-mono text-2xs text-faint">{f.duration(e.durationMs)}</span>}
              {e.error && <div className="truncate text-2xs text-crit-fg" title={e.error}>{e.error}</div>}
            </div>
          );
        },
        meta: { width: compact ? '110px' : '150px' },
      }),
    ];
  }, [t, formatTime, f, compact, navigate]);

  return <DataTable data={rows} columns={columns} getRowId={(e) => e.id} emptyMessage={t('logs.audit.empty')} loadMore={loadMore} footer={footer} />;
}
