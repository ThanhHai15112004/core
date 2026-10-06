import React, { useCallback, useState } from 'react';
import { Activity, Pause, Play, Radio, WifiOff } from 'lucide-react';
import { trafficApi } from '../../services/traffic.api';
import { usePolling } from '../../hooks/usePolling';
import { useTrafficFilters } from '../../hooks/useTrafficFilters';
import { ENDPOINT_TABS, TRAFFIC_RANGES, TRAFFIC_TABS, type EndpointTab, type TrafficTab } from '../../constants/traffic';
import { TrafficFilterBar } from '../../components/traffic/TrafficFilterBar';
import { TrafficOverviewView, type TrafficViewProps } from './TrafficOverviewView';
import { EndpointsView, ErrorsView } from './TrafficListViews';
import { EndpointDetailView } from './EndpointDetailView';
import { ApiError } from '../../../../core/services/api';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';
import '../../styles/console-runtimes.css';
import '../../styles/console-traffic.css';

const DISABLED_CODE = 'TRAFFIC_TELEMETRY_DISABLED';

/**
 * HTTP Traffic: `http-traffic/<tab>`, `http-traffic/endpoints/<routeId>/<tab>`. Không lưu từng request — chi tiết
 * request xem ở Logs (lọc theo route/status). Bộ lọc nằm trên query của hash; Pause live chỉ dừng cập nhật UI.
 */
export const TrafficSection: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const { filters, params, setFilters, go, navigate } = useTrafficFilters();
  const [paused, setPaused] = useState(false);

  const [rawTab, rawId, sub] = params;
  const id = rawId ? decodeURIComponent(rawId) : undefined;
  const tab: TrafficTab = TRAFFIC_TABS.includes(rawTab as TrafficTab) ? (rawTab as TrafficTab) : 'overview';

  const scope = JSON.stringify([filters.range, filters.method, filters.module, filters.instance, filters.internal]);
  const summary = usePolling(() => trafficApi.summary(filters), `summary:${scope}`, undefined, paused);

  const openLogs = useCallback(
    (query: Record<string, string>) => navigate(`logs/explorer?${new URLSearchParams(query).toString()}`),
    [navigate],
  );

  const unavailable = summary.error instanceof ApiError && summary.error.status === 503 ? summary.error : null;
  const data = summary.data;
  const viewProps: TrafficViewProps = { filters, summary: data, paused, now, go, openLogs, navigate };

  const renderContent = () => {
    if (unavailable) {
      const disabled = unavailable.code === DISABLED_CODE;
      return (
        <section className="tr-empty-state" role="status">
          <WifiOff size={28} />
          <h2>{t(disabled ? 'tr.empty.disabledTitle' : 'tr.empty.unavailableTitle')}</h2>
          <p>{unavailable.message}</p>
        </section>
      );
    }
    if (summary.error && !data) {
      return (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('ov.offline.title')}</h2>
            <p>{summary.error.message}</p>
          </div>
        </section>
      );
    }
    if (data && !data.hasTraffic) {
      return (
        <section className="tr-empty-state" role="status">
          <Activity size={28} />
          <h2>{t('tr.empty.noTrafficTitle')}</h2>
          <p>{t('tr.empty.noTrafficMessage')}</p>
        </section>
      );
    }
    switch (tab) {
      case 'endpoints': {
        if (id) {
          const endpointTab: EndpointTab = ENDPOINT_TABS.includes(sub as EndpointTab) ? (sub as EndpointTab) : 'overview';
          return <EndpointDetailView key={id} {...viewProps} routeId={id} tab={endpointTab} />;
        }
        return <EndpointsView {...viewProps} setFilters={setFilters} />;
      }
      case 'errors':
        return <ErrorsView {...viewProps} />;
      default:
        return <TrafficOverviewView {...viewProps} />;
    }
  };

  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">{t('nav.http-traffic')}</h1>
          <p className="ov-page-subtitle">{t('tr.subtitle')}</p>
        </div>
        <div className="tr-live">
          <span className={`tr-live-badge ${paused ? 'is-paused' : ''}`}>
            {paused ? <Pause size={12} /> : <Radio size={12} />}
            {paused ? t('tr.live.paused') : t('tr.live.live')}
          </span>
          <span className="ov-page-updated">
            <time>{summary.lastUpdated ? formatRelative(summary.lastUpdated, now) : '--'}</time>
          </span>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? t('tr.live.resume') : t('tr.live.pause')}
          </button>
        </div>
      </header>

      <div className="tr-controls">
        <nav className="rt-tabs" role="tablist" aria-label={t('nav.http-traffic')}>
          {TRAFFIC_TABS.map((tabId) => (
            <button key={tabId} type="button" role="tab" aria-selected={tab === tabId} className={tab === tabId ? 'is-active' : ''} onClick={() => go(tabId === 'overview' ? [] : [tabId])}>
              {t(`tr.tab.${tabId}`)}
            </button>
          ))}
        </nav>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
          {TRAFFIC_RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={filters.range === r} className={filters.range === r ? 'is-active' : ''} onClick={() => setFilters({ range: r })}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {!unavailable && (
        <TrafficFilterBar filters={filters} setFilters={setFilters} />
      )}

      {renderContent()}


    </div>
  );
};
