import { Search, Trash2 } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Button, Hint } from '@core/ui/primitives';
import { DetailSection, DetailSheet, KeyValueGrid, QueryView, StatusBanner } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { NamespaceRow } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { cacheKeys } from '../../sections/cache/cache-keys';

interface NamespaceSheetProps {
  name: string | null;
  onClose: () => void;
  onBrowse: (ns: string) => void;
  onOpenKey: (key: string) => void;
  onClear: (row: NamespaceRow) => void;
}

/** Chi tiết namespace: số key, dung lượng, TTL, key lớn nhất; Duyệt key / Xoá namespace. */
export function NamespaceSheet({ name, onClose, onBrowse, onOpenKey, onClear }: NamespaceSheetProps) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(cacheKeys.namespace(name ?? ''), () => cacheApi.namespace(name ?? ''), { tier: 'slow', enabled: Boolean(name), keepPrevious: false });
  const d = query.data;
  const n = d?.namespace;
  const canClear = Boolean(d?.actionsEnabled) && (n?.keys ?? 0) > 0;
  const clearButton = (
    <Button size="sm" variant="danger-outline" disabled={!canClear} onClick={() => n && onClear(n)}>
      <Trash2 />
      {t('cache.ns.clear')}
    </Button>
  );

  return (
    <DetailSheet
      open={Boolean(name)}
      onOpenChange={(o) => !o && onClose()}
      title={<span className="font-mono">{name}</span>}
      subtitle={t('cache.ns.drawerMeta')}
      status={n?.session ? { tone: 'warn', label: t('cache.ns.session') } : undefined}
      actions={
        <>
          <Button size="sm" onClick={() => name && onBrowse(name)}>
            <Search />
            {t('cache.ns.browse')}
          </Button>
          {d && !d.actionsEnabled ? (
            <Hint content={t('cache.action.disabled')}>
              <span>{clearButton}</span>
            </Hint>
          ) : (
            clearButton
          )}
        </>
      }
    >
      <QueryView query={query}>
        {(detail) => (
          <>
            {detail.namespace.session && <StatusBanner tone="warn" title={t('cache.ns.sessionWarning')} />}
            <DetailSection title={t('cache.ns.summary')}>
              <KeyValueGrid
                items={[
                  { label: t('cache.ns.keys'), value: f.compact(detail.namespace.keys), mono: true },
                  { label: t('cache.ns.memory'), value: f.bytes(detail.namespace.bytes), mono: true },
                  {
                    label: t('cache.ns.avgTtl'),
                    value: detail.namespace.avgTtlMs === null ? (detail.namespace.keys ? t('cache.ttl.none') : null) : f.duration(detail.namespace.avgTtlMs),
                    mono: true,
                  },
                  { label: t('cache.ns.persistent'), value: f.compact(detail.namespace.persistent), mono: true },
                  { label: t('cache.ns.expiringSoon'), value: f.compact(detail.namespace.expiringSoon), mono: true },
                  { label: t('cache.ns.sensitiveLabel'), value: detail.namespace.sensitive ? t('cache.ns.yes') : t('cache.ns.no') },
                ]}
              />
            </DetailSection>
            {detail.largestKeys.length > 0 && (
              <DetailSection title={t('cache.memory.largestKeys')}>
                <BarList
                  items={[...detail.largestKeys].sort((a, b) => b.bytes - a.bytes).map((k) => ({
                    id: k.key,
                    label: <span className="font-mono text-xs">{k.key}</span>,
                    value: k.bytes,
                    display: f.bytes(k.bytes),
                    tone: k.large ? 'warn' : undefined,
                    onClick: () => onOpenKey(k.key),
                  }))}
                />
              </DetailSection>
            )}
          </>
        )}
      </QueryView>
    </DetailSheet>
  );
}
