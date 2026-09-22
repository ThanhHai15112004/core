import React from 'react';
import type { TrafficFilters } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { usePolling } from '../../hooks/usePolling';
import { SLOW_THRESHOLDS } from '../../constants/traffic';
import { EndpointTable } from '../../components/traffic/EndpointTable';
import { ErrorAnalysisPanel } from '../../components/traffic/ErrorAnalysisPanel';
import { SecurityTrafficPanel } from '../../components/traffic/SecurityTrafficPanel';
import { RequestsPanel } from './RequestsPanel';
import { formatMs } from '../../utils/traffic-format';
import type { TrafficViewProps } from './TrafficOverviewView';
import { useLocale } from '../../../../core/i18n/index';

const scopeKey = (f: TrafficFilters) => JSON.stringify({ ...f, status: undefined, q: undefined, minMs: undefined });

export const EndpointsView: React.FC<TrafficViewProps & { setFilters: (patch: Partial<Record<keyof TrafficFilters, unknown>>) => void }> = ({
  filters,
  paused,
  go,
  setFilters,
}) => {
  const { t } = useLocale();
  const sort = filters.sort ?? 'traffic';
  const { data } = usePolling(() => trafficApi.endpoints(filters, sort), `ep:${scopeKey(filters)}`, undefined, paused);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('tr.endpoints.title')}</h3>
        <span className="ov-section-hint">{t('tr.endpoints.hint')}</span>
      </header>
      <EndpointTable rows={data} detailed sort={sort} onSort={(s) => setFilters({ sort: s === 'traffic' ? undefined : s })} onOpen={(id) => go(['endpoints', id])} />
    </section>
  );
};

export const RequestsView: React.FC<TrafficViewProps> = ({ filters, summary, paused, openRequest }) => {
  const { t } = useLocale();
  return (
    <RequestsPanel
      filters={filters}
      paused={paused}
      title={t('tr.tab.requests')}
      onOpen={openRequest}
      {...(summary ? { slowMs: summary.settings.slowMs } : {})}
    />
  );
};

export const SlowRequestsView: React.FC<TrafficViewProps & { setFilters: (patch: Partial<Record<keyof TrafficFilters, unknown>>) => void }> = ({
  filters,
  summary,
  paused,
  openRequest,
  setFilters,
}) => {
  const { t } = useLocale();
  const slowMs = summary?.settings.slowMs;
  const threshold = filters.minMs ?? slowMs;
  return (
    <>
      <div className="tr-toolbar">
        <span className="tr-toolbar-label">{t('tr.slow.threshold')}</span>
        <div className="ov-segmented" role="tablist" aria-label={t('tr.slow.threshold')}>
          {SLOW_THRESHOLDS.map((ms) => (
            <button key={ms} type="button" role="tab" aria-selected={threshold === ms} className={threshold === ms ? 'is-active' : ''} onClick={() => setFilters({ minMs: ms === slowMs ? undefined : ms })}>
              &gt; {formatMs(ms)}
            </button>
          ))}
        </div>
        {slowMs !== undefined && <span className="ov-section-hint">{t('tr.slow.configured', { value: formatMs(slowMs) })}</span>}
      </div>
      {threshold !== undefined && (
        <RequestsPanel
          filters={{ ...filters, minMs: threshold }}
          paused={paused}
          title={t('tr.slow.title', { value: formatMs(threshold) })}
          emptyText={t('tr.slow.empty', { value: formatMs(threshold) })}
          onOpen={openRequest}
          slowMs={threshold}
        />
      )}
    </>
  );
};

export const ErrorsView: React.FC<TrafficViewProps> = ({ filters, paused, go, openRequest, navigate }) => {
  const { t } = useLocale();
  const errors = usePolling(() => trafficApi.errors(filters), `er:${scopeKey(filters)}`, undefined, paused);
  const insights = usePolling(() => trafficApi.insights(filters), `in:${scopeKey(filters)}`, undefined, paused);
  return (
    <>
      <ErrorAnalysisPanel
        data={errors.data}
        onOpenRoute={(id) => go(['endpoints', id, 'errors'])}
        onSelectStatus={(status) => go(['requests'], { status })}
      />
      <RequestsPanel
        filters={filters}
        paused={paused}
        kind="failed"
        title={t('tr.errors.failedTitle')}
        emptyText={t('tr.errors.failedEmpty')}
        onOpen={openRequest}
      />
      <SecurityTrafficPanel
        insights={insights.data}
        onFilterStatus={(status) => go(['requests'], { status })}
        onOpenSecurity={() => navigate('security')}
      />
    </>
  );
};
