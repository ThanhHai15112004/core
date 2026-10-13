import React, { useCallback, useState } from 'react';
import { Pause, Play, Radio, RefreshCw, WifiOff } from 'lucide-react';
import { logsApi } from '../../services/logs.api';
import { usePolling } from '../../hooks/usePolling';
import { useLogsRoute } from '../../hooks/useLogsRoute';
import { LOGS_RANGES, LOGS_STATUS_TONE, LOGS_TABS } from '../../constants/logs';
import { LogDetailDrawer } from '../../components/logs/LogDetailDrawer';
import { LogsOverviewView } from './LogsOverviewView';
import { LogsExplorerView } from './LogsExplorerView';
import { ErrorGroupDetailView, LogsErrorsView } from './LogsErrorsView';
import { LogsTraceView } from './LogsTraceView';
import { LogsAuditView } from './LogsAuditView';
import { LogsConfigView } from './LogsConfigView';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';
import '../../styles/console-runtimes.css';
import '../../styles/console-traffic.css';
import '../../styles/console-performance.css';
import '../../styles/console-database.css';
import '../../styles/console-cache.css';
import '../../styles/console-worker.css';
import '../../styles/console-jobs.css';
import '../../styles/console-logs.css';

/**
 * Logs — Investigation Center của System Console: `logs` (tổng quan), `logs/explorer?…` (tìm / lọc / live tail),
 * `logs/errors[/<fp>]` (nhóm lỗi), `logs/traces[/<id>]` (trace theo correlation), `logs/audit`, `logs/configuration`.
 * Chi tiết một log mở dạng drawer (`?log=<id>`) ở mọi tab. Kho log không truy vấn được → nói rõ, không làm chết Console.
 */
export const LogsSection: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const route = useLogsRoute();
  const { tab, itemId, logId, range, filters, go, explore, openLog, openError, openTrace, setRange, navigate } = route;
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);
  const overview = usePolling(() => logsApi.overview(range), `logs:${range}:${reloadKey}`, undefined, paused);
  const data = overview.data;

  const renderTab = () => {
    const common = { range, paused, reloadKey, now, navigate };
    switch (tab) {
      case 'explorer':
        return (
          <LogsExplorerView filters={filters} explore={explore} openLog={openLog} openTrace={openTrace} navigate={navigate} now={now} selectedId={logId} />
        );
      case 'errors':
        return itemId ? (
          <ErrorGroupDetailView {...common} fingerprint={itemId} onBack={() => go('errors')} openLog={openLog} explore={explore} />
        ) : (
          <LogsErrorsView {...common} openError={openError} />
        );
      case 'traces':
        return <LogsTraceView id={itemId} openTrace={openTrace} openLog={openLog} navigate={navigate} now={now} />;
      case 'audit':
        return <LogsAuditView paused={paused} reloadKey={reloadKey} navigate={navigate} />;
      case 'configuration':
        return <LogsConfigView reloadKey={reloadKey} onChanged={bump} now={now} />;
      default:
        return <LogsOverviewView {...common} data={data} explore={explore} openError={openError} go={go} />;
    }
  };

  const tone = data ? LOGS_STATUS_TONE[data.status] : 'unknown';
  const showRange = tab === 'overview' || tab === 'errors';
  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">
            {t('nav.logs')}
            {data && (
              <span className={`pf-chip ov-tone-${tone} job-page-status`}>
                <span className="ov-dot" aria-hidden="true" /> {t(`logs.state.${data.status}`)}
              </span>
            )}
          </h1>
          <p className="ov-page-subtitle">
            {t('logs.subtitle')}
            {data && ` · ${data.environment.toUpperCase()} · ${t('logs.backend.redis')}`}
            {data?.lastEventAt && ` · ${t('logs.lastEvent', { when: formatRelative(data.lastEventAt, now) })}`}
          </p>
        </div>
        <div className="tr-live">
          <span className={`tr-live-badge ${paused ? 'is-paused' : ''}`}>
            {paused ? <Pause size={12} /> : <Radio size={12} />}
            {paused ? t('tr.live.paused') : t('tr.live.live')}
          </span>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={bump}>
            <RefreshCw size={13} /> {t('cache.refresh')}
          </button>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? t('tr.live.resume') : t('tr.live.pause')}
          </button>
        </div>
      </header>

      {overview.error && !data && (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('ov.offline.title')}</h2>
            <p>{overview.error.message}</p>
          </div>
        </section>
      )}
      {data?.status === 'unavailable' && (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('logs.unavailable.title')}</h2>
            <p>{t('logs.unavailable.message', { when: data.lastIngestAt ? formatRelative(data.lastIngestAt, now) : '—' })}</p>
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={bump}>
              <RefreshCw size={13} /> {t('logs.unavailable.retry')}
            </button>
          </div>
        </section>
      )}

      <div className="tr-controls">
        <nav className="rt-tabs" role="tablist" aria-label={t('nav.logs')}>
          {LOGS_TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'is-active' : ''} onClick={() => go(x)}>
              {t(`logs.tab.${x}`)}
              {x === 'errors' && (data?.kpis.uniqueErrors ?? 0) > 0 && <span className="ov-count">{data!.kpis.uniqueErrors}</span>}
            </button>
          ))}
        </nav>
        {showRange && (
          <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
            {LOGS_RANGES.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {renderTab()}

      {logId && (
        <LogDetailDrawer
          key={logId}
          logId={logId}
          onClose={() => openLog(null)}
          onOpenLog={openLog}
          onTrace={openTrace}
          onError={openError}
          navigate={navigate}
        />
      )}
    </div>
  );
};
