import React from 'react';
import { ArrowLeft } from 'lucide-react';
import type { EndpointDetail, StatusCount, TrafficFilters } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { usePolling } from '../../hooks/usePolling';
import { ENDPOINT_TABS, type EndpointTab } from '../../constants/traffic';
import { TrafficChart } from '../../components/traffic/TrafficChart';
import { EndpointStatusBadge, HttpStatusBadge, MethodBadge } from '../../components/traffic/TrafficBadges';
import { RequestsPanel } from './RequestsPanel';
import { formatCount, formatDelta, formatMs, formatPct, formatRps } from '../../utils/traffic-format';
import type { TrafficViewProps } from './TrafficOverviewView';
import { useLocale } from '../../../../core/i18n/index';

interface KvRow {
  label: string;
  value: string;
  warn?: boolean;
}

const Kv: React.FC<{ title: string; rows: KvRow[] }> = ({ title, rows }) => (
  <section className="ov-card ov-section">
    <header className="ov-section-head">
      <h3>{title}</h3>
    </header>
    <dl className="rt-kv">
      {rows.map((r) => (
        <div key={r.label} className={r.warn ? 'is-warn' : ''}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  </section>
);

const StatusList: React.FC<{ title: string; items: StatusCount[]; empty: string; onSelect: (s: string) => void }> = ({ title, items, empty, onSelect }) => (
  <section className="ov-card ov-section">
    <header className="ov-section-head">
      <h3>{title}</h3>
    </header>
    {items.length === 0 ? (
      <p className="ov-empty-line">{empty}</p>
    ) : (
      <ul className="tr-status-list">
        {items.map((s) => (
          <li key={s.status}>
            <button type="button" onClick={() => onSelect(String(s.status))}>
              <HttpStatusBadge status={s.status} />
              <span>{s.count.toLocaleString()}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);

/** Chi tiết một endpoint: header trạng thái + tabs Overview / Requests / Errors / Latency / Status codes. */
export const EndpointDetailView: React.FC<TrafficViewProps & { routeId: string; tab: EndpointTab }> = ({
  routeId,
  tab,
  filters,
  summary,
  paused,
  go,
  openRequest,
}) => {
  const { t, locale } = useLocale();
  const { data, error } = usePolling(() => trafficApi.endpoint(routeId, filters), `endpoint:${routeId}:${filters.range}:${filters.instance ?? ''}`, undefined, paused);
  // Trong một endpoint, bộ lọc method/module/nội bộ không còn ý nghĩa; giữ range, instance và filter request.
  const endpointFilters: TrafficFilters = {
    range: filters.range,
    internal: true,
    ...(filters.instance ? { instance: filters.instance } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.minMs ? { minMs: filters.minMs } : {}),
  };
  const slowMs = summary?.settings.slowMs;

  const back = (
    <button type="button" className="rt-back" onClick={() => go(['endpoints'])}>
      <ArrowLeft size={14} /> {t('tr.endpoints.title')}
    </button>
  );
  if (!data) {
    return (
      <>
        {back}
        <p className="ov-empty-line">{error ? error.message : t('common.loading')}</p>
      </>
    );
  }

  const d: EndpointDetail = data;
  const s = d.stats;
  const range = t(`tr.range.${d.range}`);
  const delta = (v: number | null, suffix?: string) => formatDelta(v, suffix) ?? t('tr.endpoint.noBaseline');

  const renderTab = () => {
    switch (tab) {
      case 'requests':
        return <RequestsPanel filters={endpointFilters} paused={paused} routeId={routeId} title={t('tr.endpoint.tab.requests')} onOpen={openRequest} {...(slowMs !== undefined ? { slowMs } : {})} />;
      case 'errors':
        return (
          <>
            <div className="ov-split">
              <TrafficChart filters={endpointFilters} paused={paused} routeId={routeId} metrics={['errors']} title={t('tr.endpoint.errorChart')} />
              <section className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t('tr.errors.topCodes')}</h3>
                </header>
                {d.topErrorCodes.length === 0 ? (
                  <p className="ov-empty-line">{t('tr.errors.none')}</p>
                ) : (
                  <ul className="tr-rank-list">
                    {d.topErrorCodes.map((c) => (
                      <li key={c.code} className="tr-rank-static">
                        <code>{c.code}</code>
                        <span>{c.count.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <RequestsPanel filters={endpointFilters} paused={paused} routeId={routeId} kind="failed" title={t('tr.errors.failedTitle')} emptyText={t('tr.errors.failedEmpty')} onOpen={openRequest} />
          </>
        );
      case 'latency':
        return (
          <>
            <TrafficChart filters={endpointFilters} paused={paused} routeId={routeId} metrics={['latency']} title={t('tr.endpoint.latencyChart')} />
            <RequestsPanel
              filters={endpointFilters}
              paused={paused}
              routeId={routeId}
              kind="slow"
              title={t('tr.slow.title', { value: formatMs(slowMs ?? null) })}
              emptyText={t('tr.slow.empty', { value: formatMs(slowMs ?? null) })}
              onOpen={openRequest}
              {...(slowMs !== undefined ? { slowMs } : {})}
            />
          </>
        );
      case 'status':
        return (
          <div className="ov-split">
            <TrafficChart filters={endpointFilters} paused={paused} routeId={routeId} metrics={['status']} title={t('tr.endpoint.statusChart')} />
            <StatusList title={t('tr.status.top')} items={d.topStatuses} empty={t('tr.status.empty')} onSelect={(status) => go(['endpoints', routeId, 'requests'], { status })} />
          </div>
        );
      default:
        return (
          <>
            <div className="tr-kv-row">
              <Kv
                title={t('tr.endpoint.traffic')}
                rows={[
                  { label: t('tr.col.rps'), value: `${formatRps(s.requestsPerSecond)} req/s` },
                  { label: t('tr.endpoint.requestsIn', { range }), value: formatCount(s.requests, locale) },
                  { label: t('tr.kpi.today'), value: formatCount(d.requestsToday, locale) },
                ]}
              />
              <Kv
                title={t('tr.endpoint.latency')}
                rows={[
                  { label: 'P50', value: formatMs(s.p50LatencyMs) },
                  { label: 'P95', value: formatMs(s.p95LatencyMs), warn: d.status === 'slow' },
                  { label: 'P99', value: formatMs(s.p99LatencyMs) },
                  { label: t('tr.col.avg'), value: formatMs(s.avgLatencyMs) },
                ]}
              />
              <Kv
                title={t('tr.endpoint.errors')}
                rows={[
                  { label: '4xx', value: `${formatPct(s.clientErrorRatePercent)} · ${s.clientErrors}` },
                  { label: '5xx', value: `${formatPct(s.errorRatePercent)} · ${s.serverErrors}`, warn: s.serverErrors > 0 },
                ]}
              />
              <Kv
                title={t('tr.endpoint.comparison', { range })}
                rows={[
                  { label: t('tr.endpoint.traffic'), value: delta(d.comparison.requestsPercent) },
                  { label: 'P95', value: delta(d.comparison.p95Percent), warn: (d.comparison.p95Percent ?? 0) > 0 },
                  { label: t('tr.endpoint.errors'), value: delta(d.comparison.errorRateDelta, ' pp'), warn: (d.comparison.errorRateDelta ?? 0) > 0 },
                ]}
              />
            </div>
            <TrafficChart filters={endpointFilters} paused={paused} routeId={routeId} metrics={['requests', 'latency', 'errors']} />
          </>
        );
    }
  };

  return (
    <>
      {back}
      <header className="rt-detail-head tr-endpoint-head">
        <div>
          <h2 className="tr-endpoint-title">
            <MethodBadge method={d.method} />
            <code>{d.route}</code>
            <EndpointStatusBadge status={d.status} />
          </h2>
          <p className="ov-page-subtitle">
            {`${formatRps(s.requestsPerSecond)} req/s · P95 ${formatMs(s.p95LatencyMs)} · 5xx ${formatPct(s.errorRatePercent)} · ${t('tr.col.module')}: ${d.module}`}
            {d.internal ? ` · ${t('tr.internal')}` : ''}
          </p>
          {d.reasons.length > 0 && d.status !== 'healthy' && (
            <ul className="tr-reasons">
              {d.reasons.map((r) => (
                <li key={r.code}>{r.message}</li>
              ))}
            </ul>
          )}
        </div>
        {s.requests === 0 && <span className="ov-section-hint">{t('tr.endpoint.noRequests', { range })}</span>}
      </header>

      <nav className="rt-tabs" role="tablist" aria-label={d.route}>
        {ENDPOINT_TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => go(['endpoints', routeId, id])}>
            {t(`tr.endpoint.tab.${id}`)}
          </button>
        ))}
      </nav>
      {renderTab()}
    </>
  );
};
