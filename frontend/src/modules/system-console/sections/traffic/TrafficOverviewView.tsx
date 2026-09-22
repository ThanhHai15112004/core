import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { TrafficFilters, TrafficProblem, TrafficSummary } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { usePolling } from '../../hooks/usePolling';
import { OVERVIEW_ENDPOINT_LIMIT, OVERVIEW_REQUEST_LIMIT } from '../../constants/traffic';
import { TrafficKpis } from '../../components/traffic/TrafficKpis';
import { TrafficChart } from '../../components/traffic/TrafficChart';
import { EndpointTable } from '../../components/traffic/EndpointTable';
import { StatusDistribution } from '../../components/traffic/StatusDistribution';
import { TrafficProblems } from '../../components/traffic/TrafficProblems';
import { ActiveRequestsPanel } from '../../components/traffic/ActiveRequestsPanel';
import { SecurityTrafficPanel } from '../../components/traffic/SecurityTrafficPanel';
import { TrafficSummary24h } from '../../components/traffic/TrafficSummary24h';
import { RequestsPanel } from './RequestsPanel';
import { formatMs } from '../../utils/traffic-format';
import { useLocale } from '../../../../core/i18n/index';

export interface TrafficViewProps {
  filters: TrafficFilters;
  summary: TrafficSummary | null;
  paused: boolean;
  now: number;
  go: (segments: string[], patch?: Partial<TrafficFilters>) => void;
  openRequest: (id: string) => void;
  navigate: (path: string) => void;
}

/** KPI → biểu đồ → endpoint + status → vấn đề + đang chạy → request chậm/lỗi → security + 24h. */
export const TrafficOverviewView: React.FC<TrafficViewProps> = ({ filters, summary, paused, now, go, openRequest, navigate }) => {
  const { t } = useLocale();
  const scopeKey = JSON.stringify({ ...filters, status: undefined, q: undefined, minMs: undefined, sort: undefined });
  const endpoints = usePolling(() => trafficApi.endpoints(filters, 'traffic'), `ep:${scopeKey}`, undefined, paused);
  const insights = usePolling(() => trafficApi.insights(filters), `in:${scopeKey}`, undefined, paused);
  const active = usePolling(() => trafficApi.active(filters), `ac:${scopeKey}`, undefined, paused);

  const openProblem = (p: TrafficProblem) => (p.routeId ? go(['endpoints', p.routeId]) : go(['endpoints'], { sort: 'p95' }));

  return (
    <>
      <TrafficKpis summary={summary} />
      <TrafficChart filters={filters} paused={paused} />

      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('tr.endpoints.title')}</h3>
          </header>
          <EndpointTable rows={endpoints.data ? endpoints.data.slice(0, OVERVIEW_ENDPOINT_LIMIT) : null} onOpen={(id) => go(['endpoints', id])} />
          <footer className="ov-section-foot">
            <button type="button" className="ov-link" onClick={() => go(['endpoints'])}>
              {t('tr.endpoints.viewAll', { count: endpoints.data?.length ?? 0 })} <ArrowRight size={13} />
            </button>
          </footer>
        </section>
        <StatusDistribution summary={summary} onSelect={(status) => go(['requests'], { status })} />
      </div>

      <div className="ov-split">
        <TrafficProblems problems={insights.data?.problems ?? null} now={now} onOpen={openProblem} />
        <ActiveRequestsPanel data={active.data} now={now} />
      </div>

      <RequestsPanel
        filters={filters}
        paused={paused}
        kind="notable"
        fixedLimit={OVERVIEW_REQUEST_LIMIT}
        title={t('tr.requests.notableTitle')}
        emptyText={t('tr.requests.notableEmpty', { slow: formatMs(summary?.settings.slowMs ?? null) })}
        onOpen={openRequest}
        {...(summary ? { slowMs: summary.settings.slowMs } : {})}
        footer={
          <button type="button" className="ov-link" onClick={() => go(['requests'])}>
            {t('tr.requests.viewAll')} <ArrowRight size={13} />
          </button>
        }
      />

      <div className="ov-split">
        <SecurityTrafficPanel
          insights={insights.data}
          onFilterStatus={(status) => go(['requests'], { status })}
          onOpenSecurity={() => navigate('security')}
        />
        <TrafficSummary24h insights={insights.data} />
      </div>
    </>
  );
};
