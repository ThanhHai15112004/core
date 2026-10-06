import React from 'react';
import type { TrafficFilters } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { usePolling } from '../../hooks/usePolling';
import { EndpointTable } from '../../components/traffic/EndpointTable';
import { ErrorAnalysisPanel } from '../../components/traffic/ErrorAnalysisPanel';
import { SecurityTrafficPanel } from '../../components/traffic/SecurityTrafficPanel';
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



export const ErrorsView: React.FC<TrafficViewProps> = ({ filters, paused, go, openLogs, navigate }) => {
  const errors = usePolling(() => trafficApi.errors(filters), `er:${scopeKey(filters)}`, undefined, paused);
  const insights = usePolling(() => trafficApi.insights(filters), `in:${scopeKey(filters)}`, undefined, paused);
  return (
    <>
      <ErrorAnalysisPanel
        data={errors.data}
        onOpenRoute={(id) => go(['endpoints', id, 'errors'])}
        onSelectStatus={(status) => openLogs({ status })}
      />
      <SecurityTrafficPanel
        insights={insights.data}
        onFilterStatus={(status) => openLogs({ status })}
        onOpenSecurity={() => navigate('security')}
      />
    </>
  );
};
