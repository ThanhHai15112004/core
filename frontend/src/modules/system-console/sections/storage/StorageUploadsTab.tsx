import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { XOctagon } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button, Hint } from '@core/ui/primitives';
import { AvailableView, DataTable, Panel, PanelGrid, PanelState, StatGrid, StatTile, StatusBanner, UsageBar } from '@core/ui/blocks';
import type { ActiveUpload, MultipartUpload } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { FailureTable } from '../../components/storage/FailureTable';
import { storageKeys } from './storage-keys';
import type { StoragePage } from './useStoragePage';

const activeCol = createColumnHelper<ActiveUpload>();
const multiCol = createColumnHelper<MultipartUpload>();
const MIN_MS = 60_000;
const SEC_MS = 1000;

/** Upload: đang chạy (tiến độ), multipart dở (treo + Huỷ), upload / download thất bại (→ log). */
export function StorageUploadsTab({ page, product, onAbort }: { page: StoragePage; product: string | undefined; onAbort: (u: MultipartUpload) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(storageKeys.uploads(page.range), () => storageApi.uploads(page.range));
  const d = query.data;
  const multipart = d?.multipart.available ? d.multipart.data : null;
  const stale = multipart?.filter((m) => m.stale) ?? [];

  const activeCols = useMemo(
    () => [
      activeCol.accessor('key', {
        header: t('storage.object.key'),
        cell: (c) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs text-fg">{c.getValue()}</span>
            {c.row.original.multipart && <Badge size="xs">{t('storage.uploads.multipart')}</Badge>}
          </span>
        ),
        meta: { truncate: true },
      }),
      activeCol.accessor('size', { header: t('storage.object.size'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
      activeCol.accessor('percent', { header: t('storage.uploads.progress'), cell: (c) => <UsageBar percent={c.getValue()} tone="info" />, meta: { width: '180px' } }),
      activeCol.accessor('ageSec', { header: t('storage.uploads.age'), cell: (c) => f.duration(c.getValue() * SEC_MS), meta: { align: 'right', mono: true, width: '90px' } }),
      activeCol.accessor('runtime', { header: t('storage.uploads.source'), cell: (c) => (c.getValue() ? t(`rt.name.${c.getValue()}`) : NO_VALUE), meta: { width: '120px' } }),
    ],
    [t, f],
  );
  const multiCols = useMemo(
    () => [
      multiCol.accessor('key', {
        header: t('storage.object.key'),
        cell: (c) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs text-fg">{c.getValue()}</span>
            {c.row.original.stale && (
              <Badge tone="warn" size="xs">
                {t('storage.uploads.staleChip')}
              </Badge>
            )}
          </span>
        ),
        meta: { truncate: true },
      }),
      multiCol.accessor('parts', { header: t('storage.uploads.parts'), cell: (c) => f.number(c.getValue()), meta: { align: 'right', mono: true, width: '70px' } }),
      multiCol.accessor('uploadedBytes', { header: t('storage.uploads.uploaded'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true, width: '100px' } }),
      multiCol.accessor('ageMin', { header: t('storage.uploads.age'), cell: (c) => (c.getValue() === null ? NO_VALUE : f.duration(c.getValue()! * MIN_MS)), meta: { align: 'right', mono: true, width: '90px' } }),
      multiCol.display({
        id: 'abort',
        header: () => <span className="sr-only">{t('storage.uploads.abort')}</span>,
        cell: (c) => (
          <Hint content={d?.abortEnabled ? t('storage.uploads.abort') : t('storage.action.abortDisabled')}>
            <span>
              <Button size="icon-xs" variant="ghost" disabled={!d?.abortEnabled} aria-label={t('storage.uploads.abort')} onClick={() => onAbort(c.row.original)}>
                <XOctagon className="text-crit-fg" />
              </Button>
            </span>
          </Hint>
        ),
        meta: { align: 'right', width: '44px' },
      }),
    ],
    [t, f, d?.abortEnabled, onAbort],
  );

  if (!d) return <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <>
      <StatGrid columns={4}>
        <StatTile label={t('storage.uploads.active')} value={f.number(d.active.length)} />
        <StatTile label={t('storage.uploads.stale')} value={d.multipart.available ? f.number(stale.length) : NO_VALUE} tone={stale.length > 0 ? 'warn' : undefined} hint={t('storage.uploads.staleHint', { minutes: d.staleUploadMin })} />
        <StatTile label={t('storage.uploads.failedUploads')} value={f.number(d.failedUploads.length)} tone={d.failedUploads.length > 0 ? 'warn' : 'ok'} />
        <StatTile label={t('storage.uploads.failedDownloads')} value={f.number(d.failedDownloads.length)} tone={d.failedDownloads.length > 0 ? 'warn' : 'ok'} />
      </StatGrid>
      {stale.length > 0 && (
        <StatusBanner
          tone="warn"
          title={t('storage.uploads.staleTitle')}
          description={t('storage.uploads.staleMessage', { count: stale.length, minutes: d.staleUploadMin, size: f.bytes(stale.reduce((s, u) => s + (u.uploadedBytes ?? 0), 0)) })}
        />
      )}
      <Panel title={t('storage.uploads.activeTitle')} hint={t('storage.uploads.activeHint')} flush className="mb-4">
        <DataTable data={d.active} columns={activeCols} getRowId={(a: ActiveUpload) => a.id} emptyMessage={t('storage.uploads.noActive')} />
      </Panel>
      <Panel title={t('storage.uploads.multipartTitle')} flush className="mb-4">
        <AvailableView source={d.multipart} messages={{ unsupported: t('storage.section.unsupported', { driver: product ?? '' }), disconnected: t('storage.section.disconnected') }}>
          {(list) => (
            <DataTable data={list} columns={multiCols} getRowId={(u: MultipartUpload) => u.uploadId} rowTone={(u: MultipartUpload) => (u.stale ? 'warn' : undefined)} emptyMessage={t('storage.uploads.noMultipart')} />
          )}
        </AvailableView>
      </Panel>
      <PanelGrid>
        <Panel title={t('storage.uploads.failedUploads')} flush>
          <FailureTable items={d.failedUploads} emptyMessage={t('storage.uploads.noFailedUploads')} navigate={page.navigate} />
        </Panel>
        <Panel title={t('storage.uploads.failedDownloads')} flush>
          <FailureTable items={d.failedDownloads} emptyMessage={t('storage.uploads.noFailedDownloads')} navigate={page.navigate} />
        </Panel>
      </PanelGrid>
    </>
  );
}
