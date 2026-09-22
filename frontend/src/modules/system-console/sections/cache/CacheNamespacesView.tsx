import React from 'react';
import type { CacheRange, CacheTab } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { usePolling } from '../../hooks/usePolling';
import { NamespaceTable } from '../../components/cache/NamespaceTable';
import { BarList } from '../../components/cache/TtlDistribution';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

/** Namespace do backend gom thật theo prefix của key (không hard-code): số key, dung lượng, hit rate, TTL. */
export const CacheNamespacesView: React.FC<{
  range: CacheRange;
  paused: boolean;
  warnPercent: number;
  reloadKey: number;
  go: (tab: CacheTab, id?: string | null) => void;
}> = ({ range, paused, warnPercent, reloadKey, go }) => {
  const { t, locale, formatTime } = useLocale();
  const { data, error } = usePolling(() => cacheApi.namespaces(range), `ns:${range}:${reloadKey}`, 30_000, paused);
  const ks = data?.keyspace;
  const byMemory = [...(data?.namespaces ?? [])].filter((n) => n.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const top = byMemory.slice(0, 8);
  const rest = byMemory.slice(8).reduce((s, n) => s + n.bytes, 0);
  return (
    <>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.ns.title')}</h3>
            {ks && (
              <span className="ov-section-hint">
                {t('cache.ns.scanned', { count: formatCompact(ks.totalKeys, locale), time: formatTime(Date.parse(ks.at), true) })}
                {ks.truncated && ` · ${t('cache.ns.truncated', { count: formatCompact(ks.scannedKeys, locale) })}`}
              </span>
            )}
          </header>
          {data && (
            <NamespaceTable
              rows={data.namespaces}
              warnPercent={warnPercent}
              onOpen={(name) => go('namespaces', name)}
              emptyText={ks?.totalKeys === 0 ? t('cache.empty.title') : t('cache.ns.empty')}
            />
          )}
          {data && <p className="pf-chart-note">{t('cache.ns.note', { depth: data.depth, range: t(`tr.range.${range}`) })}</p>}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.memory.byNamespace')}</h3>
          </header>
          {top.length === 0 ? (
            <p className="ov-empty-line">{t('cache.memory.noSize')}</p>
          ) : (
            <BarList
              items={[
                ...top.map((n) => ({
                  id: n.name,
                  label: <code>{n.name}</code>,
                  value: n.bytes,
                  text: formatBytes(n.bytes),
                  onClick: () => go('namespaces', n.name),
                })),
                ...(rest > 0 ? [{ id: '__rest', label: t('cache.memory.other'), value: rest, text: formatBytes(rest) }] : []),
              ]}
            />
          )}
        </section>
      </div>
    </>
  );
};
