import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Panel, PanelGrid, PanelState, QueryView } from '@core/ui/blocks';
import { BarList, type BarListItem } from '@core/ui/charts';
import type { NamespaceRow } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { NAMESPACE_BAR_LIMIT } from '../../constants/cache';
import { NamespaceTable } from '../../components/cache/NamespaceTable';
import { cacheKeys } from './cache-keys';
import type { CachePage } from './useCachePage';

const OTHER_ID = '__other';

/** Namespaces: bảng do backend gom theo prefix key (số key, dung lượng, TTL) + bộ nhớ theo namespace. */
export function CacheNamespacesTab({ page }: { page: CachePage }) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(cacheKeys.namespaces(page.range), () => cacheApi.namespaces(page.range), { tier: 'slow' });
  const d = query.data;
  const ks = d?.keyspace;

  const bars = (rows: NamespaceRow[]): BarListItem[] => {
    const byMemory = rows.filter((n) => n.bytes > 0).sort((a, b) => b.bytes - a.bytes);
    const rest = byMemory.slice(NAMESPACE_BAR_LIMIT).reduce((s, n) => s + n.bytes, 0);
    const total = byMemory.reduce((s, n) => s + n.bytes, 0);
    return [
      ...byMemory.slice(0, NAMESPACE_BAR_LIMIT).map((n) => ({
        id: n.name,
        label: <span className="font-mono text-xs">{n.name}</span>,
        value: n.bytes,
        display: f.bytes(n.bytes),
        sub: total ? f.percent((n.bytes / total) * 100) : undefined,
        onClick: () => page.openNamespace(n.name),
      })),
      ...(rest > 0 ? [{ id: OTHER_ID, label: t('cache.memory.other'), value: rest, display: f.bytes(rest), sub: f.percent((rest / total) * 100) }] : []),
    ];
  };

  return (
    <PanelGrid layout="2-1">
      <Panel
        title={t('cache.ns.title')}
        hint={d ? t('cache.ns.note', { depth: d.depth }) : undefined}
        flush
        actions={
          ks ? (
            <span className="text-xs text-muted">
              {t('cache.ns.scanned', { count: f.compact(ks.totalKeys), time: formatTime(ks.at, true) })}
              {ks.truncated && <span className="text-warn-fg"> · {t('cache.ns.truncated', { count: f.compact(ks.scannedKeys) })}</span>}
            </span>
          ) : undefined
        }
      >
        <QueryView query={query}>
          {(data) => (
            <NamespaceTable
              rows={data.namespaces}
              onOpen={(n) => page.openNamespace(n.name)}
              onBrowse={(name, ttl) => page.browseKeys({ namespace: name, ttl })}
              activeName={page.nsId}
              emptyMessage={data.keyspace?.totalKeys === 0 ? t('cache.empty.title') : t('cache.ns.empty')}
            />
          )}
        </QueryView>
      </Panel>
      <Panel title={t('cache.memory.byNamespace')}>
        <QueryView query={query} compact>
          {(data) => {
            const items = bars(data.namespaces);
            return items.length === 0 ? <PanelState status="empty" compact message={t('cache.memory.noSize')} /> : <BarList items={items} />;
          }}
        </QueryView>
      </Panel>
    </PanelGrid>
  );
}
