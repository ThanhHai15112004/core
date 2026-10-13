import { Trash2 } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Button, Hint } from '@core/ui/primitives';
import { CodeBlock, CopyButton, DetailSection, DetailSheet, HiddenValue, JsonView, KeyValueGrid, QueryView, StatusBanner } from '@core/ui/blocks';
import type { KeyDetail, KeyRow } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { cacheKeys } from '../../sections/cache/cache-keys';

interface KeySheetProps {
  keyId: string | null;
  onClose: () => void;
  onDelete: (key: Pick<KeyRow, 'key' | 'namespace' | 'bytes' | 'ttlMs'>) => void;
  onOpenNamespace: (ns: string) => void;
}

const VALUE_MAX_HEIGHT_PX = 360;

/** Chi tiết key: type, TTL, kích thước, encoding; xem trước giá trị (đã che phần nhạy cảm); Sao chép / Xoá. */
export function KeySheet({ keyId, onClose, onDelete, onOpenNamespace }: KeySheetProps) {
  const { t } = useLocale();
  const query = useLiveQuery(cacheKeys.key(keyId ?? ''), () => cacheApi.key(keyId ?? ''), { tier: 'slow', enabled: Boolean(keyId), keepPrevious: false });
  const d = query.data;
  const del = (
    <Button size="sm" variant="danger-outline" disabled={!d?.actionsEnabled} onClick={() => d && onDelete(d)}>
      <Trash2 />
      {t('cache.key.delete')}
    </Button>
  );
  return (
    <DetailSheet
      open={Boolean(keyId)}
      onOpenChange={(o) => !o && onClose()}
      title={<span className="font-mono">{keyId}</span>}
      subtitle={d ? t('cache.key.meta', { type: d.type.toUpperCase() }) : undefined}
      width="lg"
      actions={
        <>
          <CopyButton value={d?.fullKey ?? keyId ?? ''} label={t('cache.key.copy')} size="xs" />
          {d && !d.actionsEnabled ? (
            <Hint content={t('cache.action.disabled')}>
              <span>{del}</span>
            </Hint>
          ) : (
            del
          )}
        </>
      }
    >
      <QueryView query={query}>{(detail) => <KeyBody d={detail} onOpenNamespace={onOpenNamespace} />}</QueryView>
    </DetailSheet>
  );
}

function KeyBody({ d, onOpenNamespace }: { d: KeyDetail; onOpenNamespace: (ns: string) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const v = d.value;
  const notes =
    v.state === 'shown'
      ? [
          v.redacted ? t('cache.key.redacted') : null,
          v.sample.truncated
            ? v.sample.kind === 'entries' && v.sample.total !== null
              ? t('cache.key.truncatedItems', { total: f.compact(v.sample.total) })
              : t('cache.key.truncated')
            : null,
        ].filter(Boolean)
      : [];
  return (
    <>
      {d.large && <StatusBanner tone="warn" title={t('cache.key.largeWarning')} />}
      <DetailSection title={t('cache.key.metadata')}>
        <KeyValueGrid
          columns={3}
          items={[
            { label: t('cache.key.type'), value: d.type.toUpperCase(), mono: true },
            { label: t('cache.key.ttl'), value: d.ttlMs === null ? t('cache.ttl.none') : f.duration(d.ttlMs), mono: true },
            { label: t('cache.key.size'), value: <span className={d.large ? 'text-warn-fg' : undefined}>{f.bytes(d.bytes)}</span>, mono: true },
            { label: t('cache.key.length'), value: d.length === null ? null : f.compact(d.length), mono: true },
            { label: t('cache.key.encoding'), value: d.encoding, mono: true },
            {
              label: t('cache.key.namespace'),
              value: (
                <button type="button" className="text-left font-mono text-info-fg hover:underline" onClick={() => onOpenNamespace(d.namespace)}>
                  {d.namespace}
                </button>
              ),
            },
          ]}
        />
        <KeyValueGrid className="mt-3" columns={1} items={[{ label: t('cache.key.fullKey'), value: d.fullKey, mono: true }]} />
      </DetailSection>
      <DetailSection
        title={
          <Hint content={t('cache.key.previewNote')}>
            <span className="cursor-help underline decoration-dotted underline-offset-2">{t('cache.key.value')}</span>
          </Hint>
        }
      >
        {v.state === 'hidden' ? (
          <HiddenValue title={t('cache.key.hiddenTitle')} reason={t(`cache.key.hidden.${v.reason}`)} />
        ) : (
          <>
            {v.sample.kind === 'text' ? <CodeBlock code={v.sample.value} wrap maxHeight={VALUE_MAX_HEIGHT_PX} /> : <JsonView value={v.sample.value} maxHeight={VALUE_MAX_HEIGHT_PX} />}
            {notes.length > 0 && <p className="mt-1.5 text-xs text-muted">{notes.join(' ')}</p>}
          </>
        )}
      </DetailSection>
    </>
  );
}
