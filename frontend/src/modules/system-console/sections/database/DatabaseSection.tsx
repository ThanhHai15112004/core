import React, { useCallback, useState } from 'react';
import { Ban, Pause, Play, Radio, WifiOff } from 'lucide-react';
import { databaseApi } from '../../services/database.api';
import { usePolling } from '../../hooks/usePolling';
import { useDatabaseRoute } from '../../hooks/useDatabaseRoute';
import { useSessionActions } from '../../hooks/useSessionActions';
import { DB_RANGES, DB_TABS, TAB_CAPABILITY } from '../../constants/database';
import { DbHealthBanner } from '../../components/database/DbHealthBanner';
import { QueryDrawer } from '../../components/database/QueryDrawer';
import { SessionDrawer } from '../../components/database/SessionDrawer';
import { TableDrawer } from '../../components/database/TableDrawer';
import { DbOverviewView } from './DbOverviewView';
import { DbQueriesView } from './DbQueriesView';
import { DbConnectionsView } from './DbConnectionsView';
import { DbTransactionsView } from './DbTransactionsView';
import { DbTablesView } from './DbTablesView';
import { DbConfigView, DbErrorsView, DbMigrationsView } from './DbOtherViews';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';
import '../../styles/console-runtimes.css';
import '../../styles/console-traffic.css';
import '../../styles/console-performance.css';
import '../../styles/console-database.css';

/**
 * Database: `database/<tab>/<id>` — health, query, session, transaction/lock, bảng/dung lượng, migration,
 * lỗi/sự kiện, cấu hình. Thao tác nguy hiểm có xác nhận; phần driver không hỗ trợ hiện rõ lý do.
 */
export const DatabaseSection: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const { tab, id, range, query, go, setRange, setQuery, navigate } = useDatabaseRoute();
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const overview = usePolling(() => databaseApi.overview(range), `db:${range}`, undefined, paused);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);
  const actions = useSessionActions(bump);
  const data = overview.data;
  const caps = new Set(data?.capabilities ?? []);
  const driver = data?.driver ?? '';
  const slowMs = data?.settings.slowQueryMs ?? 500;
  const closeDrawer = () => go(tab);

  const renderTab = () => {
    const cap = TAB_CAPABILITY[tab];
    if (data && cap && !caps.has(cap)) {
      return (
        <section className="tr-empty-state" role="status">
          <Ban size={28} />
          <h2>{t('db.unsupported.title')}</h2>
          <p>{t('db.unsupported.message', { driver })}</p>
        </section>
      );
    }
    switch (tab) {
      case 'queries':
        return (
          <DbQueriesView
            range={range}
            paused={paused}
            driver={driver}
            canCancel={caps.has('cancel')}
            minMs={Number(query['minMs'] ?? 0) || 0}
            stateFilter={query['state'] ?? 'all'}
            setQuery={setQuery}
            go={go}
            actions={actions}
            reloadKey={reloadKey}
          />
        );
      case 'connections':
        return (
          <DbConnectionsView
            paused={paused}
            driver={driver}
            slowMs={slowMs}
            canCancel={caps.has('cancel')}
            canTerminate={caps.has('terminate')}
            runtimeFilter={query['runtime']}
            setQuery={setQuery}
            go={go}
            actions={actions}
            reloadKey={reloadKey}
          />
        );
      case 'transactions':
        return <DbTransactionsView paused={paused} driver={driver} go={go} navigate={navigate} />;
      case 'tables':
        return <DbTablesView paused={paused} driver={driver} go={go} />;
      case 'migrations':
        return <DbMigrationsView paused={paused} />;
      case 'errors':
        return <DbErrorsView range={range} paused={paused} go={go} navigate={navigate} />;
      case 'configuration':
        return <DbConfigView />;
      default:
        return <DbOverviewView data={data} now={now} paused={paused} go={go} actions={actions} />;
    }
  };

  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">{t('nav.database')}</h1>
          <p className="ov-page-subtitle">{t('db.subtitle')}</p>
        </div>
        <div className="tr-live">
          <span className={`tr-live-badge ${paused ? 'is-paused' : ''}`}>
            {paused ? <Pause size={12} /> : <Radio size={12} />}
            {paused ? t('tr.live.paused') : t('tr.live.live')}
          </span>
          <span className="ov-page-updated">
            <time>{overview.lastUpdated ? formatRelative(overview.lastUpdated, now) : '--'}</time>
          </span>
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
        data && <DbHealthBanner data={data} now={now} />
      )}

      <div className="tr-controls">
        <nav className="rt-tabs" role="tablist" aria-label={t('nav.database')}>
          {DB_TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'is-active' : ''} onClick={() => go(x)}>
              {t(`db.tab.${x}`)}
              {x === 'overview' && data && data.alerts.length > 0 && <span className="ov-count">{data.alerts.length}</span>}
            </button>
          ))}
        </nav>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
          {DB_RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {renderTab()}

      {id && tab === 'queries' && <QueryDrawer key={id} id={id} range={range} onClose={closeDrawer} navigate={navigate} />}
      {id && tab === 'connections' && (
        <SessionDrawer
          key={`${id}:${reloadKey}`}
          id={id}
          canCancel={caps.has('cancel')}
          canTerminate={caps.has('terminate')}
          onClose={closeDrawer}
          onCancel={actions.requestCancel}
          onTerminate={actions.requestTerminate}
          navigate={navigate}
        />
      )}
      {id && tab === 'tables' && <TableDrawer key={id} name={id} onClose={closeDrawer} />}
      {actions.modal}
    </div>
  );
};
