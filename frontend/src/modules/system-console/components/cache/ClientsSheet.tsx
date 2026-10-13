import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { AvailableView, DataTable, DetailSheet, QueryView } from '@core/ui/blocks';
import type { CacheClient } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { cacheKeys } from '../../sections/cache/cache-keys';

const col = createColumnHelper<CacheClient>();

/** Danh sách kết nối Redis của core (CLIENT LIST, lọc tên `core-*`): runtime, lệnh cuối, tuổi, rảnh, địa chỉ. */
export function ClientsSheet({ open, onOpenChange, navigate }: { open: boolean; onOpenChange: (open: boolean) => void; navigate: (path: string) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(cacheKeys.clients(), () => cacheApi.clients(), { enabled: open });
  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: t('cache.clients.name'),
        cell: (c) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs text-fg">{c.getValue()}</span>
            {c.row.original.bull && <Badge size="xs">{t('cache.clients.bull')}</Badge>}
          </span>
        ),
        meta: { truncate: true, width: '260px' },
      }),
      col.accessor('runtime', {
        header: t('cache.clients.runtime'),
        cell: (c) =>
          c.getValue() ? (
            <button type="button" className="text-info-fg hover:underline" onClick={() => navigate(`runtimes/${c.getValue()}`)}>
              {t(`rt.name.${c.getValue()}`)}
            </button>
          ) : (
            NO_VALUE
          ),
      }),
      col.accessor('command', {
        header: t('cache.clients.command'),
        cell: (c) => (
          <span className="font-mono text-xs">
            {c.getValue() ?? NO_VALUE}
            {c.row.original.blocked && <span className="ml-1.5 text-faint">{c.row.original.bull ? t('cache.clients.waitingJob') : t('cache.clients.blockedCmd')}</span>}
          </span>
        ),
      }),
      col.accessor('ageSec', { header: t('cache.clients.age'), cell: (c) => f.uptime(c.getValue()), meta: { align: 'right', mono: true } }),
      col.accessor('idleSec', { header: t('cache.clients.idle'), cell: (c) => f.uptime(c.getValue()), meta: { align: 'right', mono: true } }),
      col.accessor('addr', { header: t('cache.clients.addr'), cell: (c) => c.getValue() ?? NO_VALUE, meta: { mono: true } }),
    ],
    [t, f, navigate],
  );
  return (
    <DetailSheet open={open} onOpenChange={onOpenChange} title={t('cache.clients.title')} subtitle={t('cache.clients.blockedNote')} width="xl">
      <QueryView query={query}>
        {(d) => (
          <AvailableView source={d.clients}>
            {(list) => <DataTable data={list} columns={columns} getRowId={(c) => c.id} emptyMessage={t('cache.clients.empty')} initialSorting={[{ id: 'runtime', desc: false }]} />}
          </AvailableView>
        )}
      </QueryView>
    </DetailSheet>
  );
}
