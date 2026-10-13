import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, Eye, Link2, Trash2 } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation, useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { cn } from '@core/lib/cn';
import { Badge, Button, Hint, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, buttonVariants } from '@core/ui/primitives';
import { CodeBlock, CopyButton, DataTable, DetailSection, DetailSheet, HiddenValue, KeyValueGrid, QueryView, StatusBanner } from '@core/ui/blocks';
import type { ObjectDetail } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { PREVIEW_MAX_HEIGHT_PX, SIGNED_URL_TTLS, VERSION_ID_LENGTH } from '../../constants/storage';
import { storageKeys } from '../../sections/storage/storage-keys';

type Version = NonNullable<ObjectDetail['versions']>[number];
const versionCol = createColumnHelper<Version>();

interface ObjectSheetProps {
  objectKey: string | null;
  onClose: () => void;
  onDelete: (d: ObjectDetail, versionId?: string) => void;
  onOpenContainer: (c: string) => void;
}

/**
 * Chi tiết object: metadata (không tự tải nội dung), retention, version; Copy key, Tải về, URL tạm, Xem trước (chỉ khi bấm),
 * Xoá — mỗi thao tác theo capability và cấu hình môi trường của backend.
 */
export function ObjectSheet({ objectKey, onClose, onDelete, onOpenContainer }: ObjectSheetProps) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(storageKeys.object(objectKey ?? ''), () => storageApi.object(objectKey ?? ''), { tier: 'slow', enabled: Boolean(objectKey), keepPrevious: false });
  const d = query.data;
  const s = d?.settings;
  const retained = Boolean(d?.retention?.active);
  const deleteBlocked = !s?.delete ? t('storage.action.deleteDisabled') : retained ? t('storage.object.retentionBlocked') : null;
  const deleteButton = d && (
    <Button size="sm" variant="danger-outline" disabled={Boolean(deleteBlocked)} onClick={() => onDelete(d)}>
      <Trash2 />
      {d.versions ? t('storage.object.deleteCurrent') : t('storage.object.delete')}
    </Button>
  );

  return (
    <DetailSheet
      open={Boolean(objectKey)}
      onOpenChange={(o) => !o && onClose()}
      title={<span className="font-mono">{objectKey}</span>}
      subtitle={d ? `${t(`storage.kind.${d.kind}`)} · ${f.bytes(d.size)}` : undefined}
      width="lg"
      actions={
        d && s ? (
          <>
            <CopyButton value={d.key} label={t('storage.object.copyKey')} size="xs" />
            {s.download && (
              <a className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'no-underline')} href={storageApi.downloadUrl(d.key)} download>
                <Download />
                {t('storage.object.download')}
              </a>
            )}
            {deleteBlocked ? (
              <Hint content={deleteBlocked}>
                <span>{deleteButton}</span>
              </Hint>
            ) : (
              deleteButton
            )}
          </>
        ) : undefined
      }
    >
      <QueryView query={query}>{(detail) => <ObjectBody key={detail.key} d={detail} onDelete={onDelete} onOpenContainer={onOpenContainer} />}</QueryView>
    </DetailSheet>
  );
}

function ObjectBody({ d, onDelete, onOpenContainer }: { d: ObjectDetail; onDelete: ObjectSheetProps['onDelete']; onOpenContainer: (c: string) => void }) {
  const { t, formatTime, locale } = useLocale();
  const f = useFormat();
  const s = d.settings;
  const retained = Boolean(d.retention?.active);
  const ttls = SIGNED_URL_TTLS.filter((x) => s.signedUrlMaxSec >= x);
  const [ttl, setTtl] = useState<number>(ttls[0] ?? SIGNED_URL_TTLS[0]);
  const signed = useAppMutation({ mutationFn: () => storageApi.signedUrl(d.key, ttl), success: false });
  const preview = useAppMutation({ mutationFn: () => storageApi.preview(d.key), success: false });
  const date = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString(locale)} ${formatTime(iso, true)}` : null);
  const canPreview = s.preview && d.previewable;

  const versionCols = useMemo(
    () => [
      versionCol.accessor('versionId', {
        header: t('storage.object.version'),
        cell: (c) => (
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-fg">{c.getValue().slice(0, VERSION_ID_LENGTH)}</span>
            {c.row.original.isLatest && (
              <Badge tone="ok" size="xs">
                {t('storage.object.current')}
              </Badge>
            )}
            {c.row.original.deleteMarker && (
              <Badge tone="warn" size="xs">
                {t('storage.object.deleteMarker')}
              </Badge>
            )}
          </span>
        ),
      }),
      versionCol.accessor('size', { header: t('storage.object.size'), cell: (c) => (c.row.original.deleteMarker ? NO_VALUE : f.bytes(c.getValue())), meta: { align: 'right', mono: true } }),
      versionCol.accessor('lastModified', { header: t('storage.object.modified'), cell: (c) => date(c.getValue()) ?? NO_VALUE, meta: { align: 'right', mono: true } }),
      versionCol.display({
        id: 'delete',
        header: () => <span className="sr-only">{t('storage.object.deleteVersion')}</span>,
        cell: (c) => (
          <Hint content={t('storage.object.deleteVersion')}>
            <span>
              <Button size="icon-xs" variant="ghost" disabled={!s.delete || retained} aria-label={t('storage.object.deleteVersion')} onClick={() => onDelete(d, c.row.original.versionId)}>
                <Trash2 className="text-crit-fg" />
              </Button>
            </span>
          </Hint>
        ),
        meta: { align: 'right', width: '44px' },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, f, d, s.delete, retained, onDelete],
  );

  const p = preview.data;
  return (
    <>
      {d.large && <StatusBanner tone="warn" title={t('storage.object.largeWarning')} />}
      {retained && d.retention && (
        <StatusBanner
          tone="warn"
          title={d.retention.legalHold ? t('storage.object.legalHold') : t('storage.object.retention', { mode: d.retention.mode ?? '', until: date(d.retention.retainUntil) ?? NO_VALUE })}
        />
      )}
      <DetailSection title={t('storage.object.metadata')}>
        <KeyValueGrid
          items={[
            { label: t('storage.object.size'), value: <span className={d.large ? 'text-warn-fg' : undefined}>{f.bytes(d.size)}</span>, mono: true },
            { label: t('storage.object.contentType'), value: d.contentType, mono: true },
            {
              label: t('storage.object.container'),
              value: (
                <button type="button" className="text-left font-mono text-info-fg hover:underline" onClick={() => onOpenContainer(d.container)}>
                  {d.container}
                </button>
              ),
            },
            { label: t('storage.object.modified'), value: date(d.lastModified), mono: true },
            { label: t('storage.object.created'), value: date(d.createdAt), mono: true },
            ...(d.storageClass ? [{ label: t('storage.object.storageClass'), value: d.storageClass, mono: true }] : []),
            ...(d.etag ? [{ label: t('storage.object.etag'), value: d.etag, mono: true }] : []),
            ...(d.versionId ? [{ label: t('storage.object.version'), value: d.versionId, mono: true }] : []),
            ...(d.checksum ? [{ label: t('storage.object.checksum'), value: d.checksum, mono: true }] : []),
          ]}
        />
      </DetailSection>

      {s.signedUrl && (
        <DetailSection title={t('storage.object.signedTitle')}>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(ttl)} onValueChange={(v) => setTtl(Number(v))}>
              <SelectTrigger size="sm" className="w-36" aria-label={t('storage.object.expiresIn')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ttls.map((x) => (
                  <SelectItem key={x} value={String(x)}>
                    {t(`storage.object.ttl.${x}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => signed.mutate()} disabled={signed.isPending}>
              <Link2 />
              {t('storage.object.generate')}
            </Button>
          </div>
          {signed.data && (
            <div className="mt-2">
              <CodeBlock code={signed.data.url} wrap maxHeight={PREVIEW_MAX_HEIGHT_PX} />
              <p className="mt-1 text-xs text-muted">{t('storage.object.signedDone', { time: date(signed.data.expiresAt) ?? NO_VALUE })}</p>
            </div>
          )}
        </DetailSection>
      )}

      <DetailSection title={t('storage.object.content')}>
        {p ? (
          p.kind === 'image' ? (
            <img className="max-h-96 max-w-full rounded-md border border-border" src={`data:${p.contentType};base64,${p.base64}`} alt={d.key} />
          ) : (
            <>
              <CodeBlock code={p.text} wrap maxHeight={PREVIEW_MAX_HEIGHT_PX} />
              {(p.redacted || p.truncated) && (
                <p className="mt-1 text-xs text-muted">
                  {[p.redacted ? t('storage.object.redacted') : '', p.truncated ? t('storage.object.previewTruncated') : ''].filter(Boolean).join(' ')}
                </p>
              )}
            </>
          )
        ) : (
          <HiddenValue
            title={t('storage.object.metadataOnly')}
            reason={
              d.sensitive
                ? t('storage.object.hidden.sensitive')
                : !s.preview
                  ? t('storage.object.hidden.disabled')
                  : !d.previewable
                    ? t('storage.object.hidden.unsupported')
                    : t('storage.object.hidden.click')
            }
            action={
              canPreview ? (
                <Button size="sm" onClick={() => preview.mutate()} disabled={preview.isPending}>
                  <Eye />
                  {t('storage.object.preview')}
                </Button>
              ) : undefined
            }
          />
        )}
      </DetailSection>

      {d.versions && (
        <DetailSection title={t('storage.object.versions', { count: d.versions.length })}>
          <DataTable data={d.versions} columns={versionCols} getRowId={(v) => v.versionId} />
        </DetailSection>
      )}
    </>
  );
}
