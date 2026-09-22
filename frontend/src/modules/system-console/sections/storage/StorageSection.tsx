import React, { useCallback, useMemo, useState } from 'react';
import { Ban, Pause, Play, Radio, RefreshCw, WifiOff } from 'lucide-react';
import type { ObjectFilter } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { usePolling } from '../../hooks/usePolling';
import { useStorageRoute } from '../../hooks/useStorageRoute';
import { useStorageActions } from '../../hooks/useStorageActions';
import { OBJECT_AGES, OBJECT_KINDS, STORAGE_RANGES, STORAGE_TABS, TAB_CAPABILITY } from '../../constants/storage';
import { StorageHealthBanner } from '../../components/storage/StorageHealthBanner';
import { ContainerDrawer } from '../../components/storage/ContainerDrawer';
import { ObjectDrawer } from '../../components/storage/ObjectDrawer';
import { StorageOverviewView } from './StorageOverviewView';
import { StorageTrafficView } from './StorageTrafficView';
import { StorageContainersView } from './StorageContainersView';
import { StorageObjectsView } from './StorageObjectsView';
import { StorageLifecycleView, StorageUploadsView, StorageUsageView } from './StorageInsightViews';
import { StorageConfigView, StorageErrorsView, StorageOperationsView } from './StorageOtherViews';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';
import '../../styles/console-runtimes.css';
import '../../styles/console-traffic.css';
import '../../styles/console-performance.css';
import '../../styles/console-database.css';
import '../../styles/console-cache.css';
import '../../styles/console-storage.css';

/**
 * Storage: `storage/<tab>/<id>` — health, capacity & tăng trưởng, traffic, container, object explorer, upload,
 * lifecycle, lỗi & sự kiện, audit, cấu hình. Phần provider không hỗ trợ hiện rõ lý do (theo capability).
 */
export const StorageSection: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const { tab, id, range, query, go, setRange, setQuery, navigate } = useStorageRoute();
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const overview = usePolling(() => storageApi.overview(range), `storage:${range}:${reloadKey}`, undefined, paused);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);
  const actions = useStorageActions((action) => {
    // Object vừa xoá không còn → đóng drawer thay vì tải lại (404).
    if (action === 'delete' && id && tab === 'objects') go(tab, null, query);
    bump();
  });
  const data = overview.data;
  const caps = new Set(data?.capabilities ?? []);
  const product = data?.provider.product ?? '';
  const driver = data?.provider.driver ?? '';
  const closeDrawer = () => go(tab, null, tab === 'objects' ? query : {});

  const filter = useMemo<ObjectFilter>(
    () => ({
      container: query['container'] ?? '',
      prefix: query['prefix'] ?? '',
      kind: OBJECT_KINDS.includes(query['kind'] as never) ? (query['kind'] as ObjectFilter['kind']) : '',
      age: OBJECT_AGES.includes(query['age'] as never) ? (query['age'] as ObjectFilter['age']) : '',
      minSizeMb: query['minSizeMb'] ?? '',
    }),
    [query],
  );
  const setFilter = (patch: Partial<ObjectFilter>) => {
    const next = { ...filter, ...patch };
    setQuery({
      container: next.container || undefined,
      prefix: next.prefix || undefined,
      kind: next.kind || undefined,
      age: next.age || undefined,
      minSizeMb: next.minSizeMb || undefined,
    });
  };

  const renderTab = () => {
    const cap = TAB_CAPABILITY[tab];
    if (data && cap && !caps.has(cap)) {
      return (
        <section className="tr-empty-state" role="status">
          <Ban size={28} />
          <h2>{t('storage.unsupported.title')}</h2>
          <p>{t('storage.unsupported.message', { product })}</p>
        </section>
      );
    }
    switch (tab) {
      case 'traffic':
        return <StorageTrafficView range={range} paused={paused} driver={driver} product={product} />;
      case 'containers':
        return <StorageContainersView range={range} paused={paused} driver={driver} reloadKey={reloadKey} go={go} />;
      case 'objects':
        return (
          <StorageObjectsView
            product={product}
            filter={filter}
            setFilter={setFilter}
            reloadKey={reloadKey}
            go={(nextTab, nextId, q) => go(nextTab, nextId, { ...query, ...q })}
          />
        );
      case 'uploads':
        return <StorageUploadsView range={range} paused={paused} product={product} reloadKey={reloadKey} navigate={navigate} onAbort={actions.requestAbort} />;
      case 'usage':
        return <StorageUsageView product={product} reloadKey={reloadKey} go={go} />;
      case 'lifecycle':
        return <StorageLifecycleView product={product} />;
      case 'errors':
        return <StorageErrorsView range={range} paused={paused} reloadKey={reloadKey} go={go} navigate={navigate} />;
      case 'operations':
        return <StorageOperationsView paused={paused} reloadKey={reloadKey} />;
      case 'configuration':
        return <StorageConfigView />;
      default:
        return <StorageOverviewView data={data} now={now} paused={paused} go={go} navigate={navigate} />;
    }
  };

  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">{t('nav.storage')}</h1>
          <p className="ov-page-subtitle">{t('storage.subtitle')}</p>
        </div>
        <div className="tr-live">
          <span className={`tr-live-badge ${paused ? 'is-paused' : ''}`}>
            {paused ? <Pause size={12} /> : <Radio size={12} />}
            {paused ? t('tr.live.paused') : t('tr.live.live')}
          </span>
          <span className="ov-page-updated">
            <time>{overview.lastUpdated ? formatRelative(overview.lastUpdated, now) : '--'}</time>
          </span>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={bump}>
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
        data && <StorageHealthBanner data={data} now={now} onTested={bump} />
      )}

      <div className="tr-controls">
        <nav className="rt-tabs" role="tablist" aria-label={t('nav.storage')}>
          {STORAGE_TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'is-active' : ''} onClick={() => go(x)}>
              {t(`storage.tab.${x}`)}
              {x === 'overview' && data && data.alerts.filter((a) => a.severity !== 'info').length > 0 && (
                <span className="ov-count">{data.alerts.filter((a) => a.severity !== 'info').length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
          {STORAGE_RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {renderTab()}

      {id && tab === 'containers' && (
        <ContainerDrawer
          key={id}
          name={id}
          range={range}
          canLifecycle={caps.has('lifecycle')}
          onClose={closeDrawer}
          onBrowse={(c) => go('objects', null, { container: c })}
          onLifecycle={() => go('lifecycle')}
          onOpenObject={(key) => go('objects', key, { container: id })}
        />
      )}
      {id && tab === 'objects' && (
        <ObjectDrawer
          key={id}
          objectKey={id}
          reloadKey={reloadKey}
          onClose={closeDrawer}
          onDelete={actions.requestDelete}
          onOpenContainer={(c) => go('containers', c)}
        />
      )}
      {actions.modal}
    </div>
  );
};
