import React, { useCallback, useMemo, useState } from 'react';
import { Ban, Pause, Play, Radio, RefreshCw, WifiOff } from 'lucide-react';
import type { KeyFilter } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { usePolling } from '../../hooks/usePolling';
import { useCacheRoute } from '../../hooks/useCacheRoute';
import { useCacheActions } from '../../hooks/useCacheActions';
import { CACHE_RANGES, CACHE_TABS, TAB_CAPABILITY } from '../../constants/cache';
import { CacheHealthBanner } from '../../components/cache/CacheHealthBanner';
import { NamespaceDrawer } from '../../components/cache/NamespaceDrawer';
import { KeyDrawer } from '../../components/cache/KeyDrawer';
import { CacheOverviewView } from './CacheOverviewView';
import { CacheNamespacesView } from './CacheNamespacesView';
import { CacheKeysView } from './CacheKeysView';
import { CacheConnectionsView, CacheMemoryView, CacheTtlView } from './CacheInsightViews';
import { CacheConfigView, CacheEventsView, CacheOperationsView } from './CacheOtherViews';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';
import '../../styles/console-runtimes.css';
import '../../styles/console-traffic.css';
import '../../styles/console-performance.css';
import '../../styles/console-database.css';
import '../../styles/console-cache.css';

const TTL_FILTERS: KeyFilter['ttl'][] = ['any', 'persistent', 'expiring', 'lt1m'];

/**
 * Cache: `cache/<tab>/<id>` — hiệu quả (hit/miss), bộ nhớ, keyspace/namespace/TTL, kết nối, lỗi & sự kiện,
 * thao tác đúng phạm vi (key → namespace → flush ở Danger Zone). Phần driver không hỗ trợ hiện rõ lý do.
 */
export const CacheSection: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const { tab, id, range, query, go, setRange, setQuery, navigate } = useCacheRoute();
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const overview = usePolling(() => cacheApi.overview(range), `cache:${range}:${reloadKey}`, undefined, paused);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);
  // Đối tượng vừa xoá không còn → đóng drawer của nó thay vì tải lại (404).
  const actions = useCacheActions(() => {
    if (id) go(tab, null, tab === 'keys' ? query : {});
    bump();
  });
  const data = overview.data;
  const caps = new Set(data?.capabilities ?? []);
  const driver = data?.driver ?? '';
  const closeDrawer = () => go(tab, null, tab === 'keys' ? query : {});

  const filter = useMemo<KeyFilter>(
    () => ({
      match: query['match'] ?? '',
      type: query['type'] ?? '',
      ttl: TTL_FILTERS.includes(query['ttl'] as KeyFilter['ttl']) ? (query['ttl'] as KeyFilter['ttl']) : 'any',
      namespace: query['namespace'] ?? '',
    }),
    [query],
  );
  const setFilter = (patch: Partial<KeyFilter>) => {
    const next = { ...filter, ...patch };
    setQuery({
      match: next.match || undefined,
      type: next.type || undefined,
      ttl: next.ttl === 'any' ? undefined : next.ttl,
      namespace: next.namespace || undefined,
    });
  };

  const renderTab = () => {
    const cap = TAB_CAPABILITY[tab];
    if (data && cap && !caps.has(cap)) {
      return (
        <section className="tr-empty-state" role="status">
          <Ban size={28} />
          <h2>{t('cache.unsupported.title')}</h2>
          <p>{t('cache.unsupported.message', { driver: t(`cache.driver.${driver}`) })}</p>
        </section>
      );
    }
    switch (tab) {
      case 'namespaces':
        return <CacheNamespacesView range={range} paused={paused} warnPercent={data?.settings.hitRateWarnPercent ?? 80} reloadKey={reloadKey} go={go} />;
      case 'keys':
        return (
          <CacheKeysView
            driver={driver}
            filter={filter}
            setFilter={setFilter}
            actionsEnabled={data?.settings.actionsEnabled ?? false}
            reloadKey={reloadKey}
            go={(nextTab, nextId, q) => go(nextTab, nextId, { ...query, ...q })}
            onDelete={actions.requestDeleteKey}
          />
        );
      case 'memory':
        return <CacheMemoryView range={range} paused={paused} driver={driver} reloadKey={reloadKey} go={go} />;
      case 'ttl':
        return <CacheTtlView paused={paused} reloadKey={reloadKey} go={go} />;
      case 'connections':
        return <CacheConnectionsView paused={paused} driver={driver} navigate={navigate} />;
      case 'events':
        return <CacheEventsView range={range} paused={paused} reloadKey={reloadKey} go={go} navigate={navigate} />;
      case 'operations':
        return (
          <CacheOperationsView
            paused={paused}
            reloadKey={reloadKey}
            flushEnabled={data?.settings.flushEnabled ?? false}
            actionsEnabled={data?.settings.actionsEnabled ?? false}
            onFlush={() => void actions.requestFlush()}
          />
        );
      case 'configuration':
        return <CacheConfigView />;
      default:
        return <CacheOverviewView data={data} now={now} paused={paused} go={go} navigate={navigate} />;
    }
  };

  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">{t('nav.cache')}</h1>
          <p className="ov-page-subtitle">{t('cache.subtitle')}</p>
        </div>
        <div className="tr-live">
          <span className={`tr-live-badge ${paused ? 'is-paused' : ''}`}>
            {paused ? <Pause size={12} /> : <Radio size={12} />}
            {paused ? t('tr.live.paused') : t('tr.live.live')}
          </span>
          <span className="ov-page-updated">
            <time>{overview.lastUpdated ? formatRelative(overview.lastUpdated, now) : '--'}</time>
          </span>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={bump} aria-label={t('cache.refresh')}>
            <RefreshCw size={13} /> {t('cache.refresh')}
          </button>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? t('tr.live.resume') : t('tr.live.pause')}
          </button>
        </div>
      </header>

      {overview.error && !data ? (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('ov.offline.title')}</h2>
            <p>{overview.error.message}</p>
          </div>
        </section>
      ) : (
        data && <CacheHealthBanner data={data} now={now} />
      )}

      <div className="tr-controls">
        <nav className="rt-tabs" role="tablist" aria-label={t('nav.cache')}>
          {CACHE_TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'is-active' : ''} onClick={() => go(x)}>
              {t(`cache.tab.${x}`)}
              {x === 'overview' && data && data.alerts.filter((a) => a.severity !== 'info').length > 0 && (
                <span className="ov-count">{data.alerts.filter((a) => a.severity !== 'info').length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
          {CACHE_RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {renderTab()}

      {id && tab === 'namespaces' && (
        <NamespaceDrawer
          key={id}
          name={id}
          range={range}
          reloadKey={reloadKey}
          onClose={closeDrawer}
          onBrowse={(ns) => go('keys', null, { namespace: ns })}
          onOpenKey={(key) => go('keys', key, { namespace: id })}
          onClear={actions.requestClearNamespace}
        />
      )}
      {id && tab === 'keys' && (
        <KeyDrawer
          key={id}
          cacheKey={id}
          reloadKey={reloadKey}
          onClose={closeDrawer}
          onDelete={(d) => actions.requestDeleteKey({ key: d.key, namespace: d.namespace, type: d.type, bytes: d.bytes, ttlMs: d.ttlMs })}
          onOpenNamespace={(ns) => go('namespaces', ns)}
        />
      )}
      {actions.modal}
    </div>
  );
};
