import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { Button } from '@core/ui/primitives';
import { AlertList, KeyValueGrid, Panel, PanelGrid, PanelState, QueryView, type AlertItem } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { EndpointRow, TrafficProblem, TrafficSummary } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { ENDPOINT_TONE, STATUS_CLASS_TONE, TOP_LIST_SIZE, TRAFFIC_CHART_METRICS } from '../../constants/traffic';
import { TrafficKpis } from '../../components/traffic/TrafficKpis';
import { TrafficChart } from '../../components/traffic/TrafficChart';
import { EndpointLabel, HttpStatusBadge } from '../../components/traffic/TrafficBadges';
import { useTrafficFormat } from '../../components/traffic/useTrafficFormat';
import { trafficKeys } from './traffic-keys';
import type { TrafficPage } from './useTrafficPage';

const slowest = (rows: EndpointRow[]) =>
  rows
    .filter((r) => r.stats.requests > 0 && r.stats.p95LatencyMs !== null)
    .sort((a, b) => (b.stats.p95LatencyMs ?? 0) - (a.stats.p95LatencyMs ?? 0))
    .slice(0, TOP_LIST_SIZE);

const mostErrors = (rows: EndpointRow[]) =>
  rows
    .filter((r) => r.stats.serverErrors > 0)
    .sort((a, b) => b.stats.serverErrors - a.stats.serverErrors || b.stats.errorRatePercent - a.stats.errorRatePercent)
    .slice(0, TOP_LIST_SIZE);

/** Tổng quan: 6 số chính → requests + latency → status 2xx–5xx → vấn đề + endpoint chậm / lỗi → 24 giờ qua. */
export function TrafficOverviewTab({ page, summary: summaryQuery }: { page: TrafficPage; summary: UseQueryResult<TrafficSummary> }) {
  const summary = summaryQuery.data;
  const { t, formatTime } = useLocale();
  const tf = useTrafficFormat();
  const { filters, go, openEndpoint, openLogs } = page;
  const endpoints = useLiveQuery(trafficKeys.endpoints(filters), () => trafficApi.endpoints(filters, 'traffic'));
  const insights = useLiveQuery(trafficKeys.insights(filters), () => trafficApi.insights(filters));

  const openProblem = (p: TrafficProblem) => (p.routeId ? openEndpoint(p.routeId) : go('endpoints', { sort: 'p95' }));
  const problems: AlertItem[] = (insights.data?.problems ?? []).map((p, i) => ({
    id: `${p.kind}-${p.routeId ?? i}`,
    tone: p.severity === 'critical' ? 'crit' : 'warn',
    title: p.title,
    detail: p.message || null,
    since: p.since,
    onInspect: () => openProblem(p),
  }));

  const day = insights.data?.last24h;

  return (
    <>
      <TrafficKpis summary={summary} failed={summaryQuery.isError} onErrors={() => go('errors')} />

      <PanelGrid>
        <TrafficChart title={t('tr.chart.traffic')} filters={filters} metrics={TRAFFIC_CHART_METRICS} />
        <TrafficChart title={t('tr.chart.latency')} filters={filters} metrics={['latency']} latencyThresholdMs={summary?.settings.endpointP95WarnMs} />
      </PanelGrid>

      <PanelGrid layout="2-1">
        <TrafficChart title={t('tr.chart.status')} filters={filters} metrics={['status']} />
        <Panel title={t('tr.status.title')} hint={t('tr.status.hint')}>
          {!summary ? (
            <QueryView query={summaryQuery} compact>
              {() => null}
            </QueryView>
          ) : summary.stats.requests === 0 ? (
            <PanelState status="empty" message={t('tr.status.empty')} compact />
          ) : (
            <>
              <BarList
                items={summary.statusClasses.map((c) => ({
                  id: c.class,
                  label: <span className="font-mono">{c.class}</span>,
                  value: c.count,
                  display: `${tf.count(c.count)} · ${tf.rate(c.percent)}`,
                  tone: STATUS_CLASS_TONE[c.class],
                  onClick: c.count > 0 ? () => openLogs({ status: c.class }) : undefined,
                }))}
              />
              {summary.topStatuses.length > 0 && (
                <>
                  <h3 className="mb-1.5 mt-4 text-xs font-medium text-muted">{t('tr.status.top')}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.topStatuses.map((s) => (
                      <button
                        key={s.status}
                        type="button"
                        onClick={() => openLogs({ status: String(s.status) })}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 hover:bg-panel-2"
                      >
                        <HttpStatusBadge status={s.status} />
                        <span className="font-mono text-xs tabular-nums text-fg-2">{tf.count(s.count)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </Panel>
      </PanelGrid>

      <PanelGrid layout={3}>
        <Panel title={t('tr.problems.title')}>
          <QueryView query={insights} compact>
            {() => <AlertList items={problems} emptyMessage={t('tr.problems.none')} />}
          </QueryView>
        </Panel>
        <Panel
          title={t('tr.top.slowest')}
          actions={
            <Button size="xs" variant="ghost" onClick={() => go('endpoints', { sort: 'p95' })}>
              {t('tr.top.viewAll')}
            </Button>
          }
        >
          <QueryView query={endpoints} compact isEmpty={(rows) => slowest(rows).length === 0} emptyMessage={t('tr.top.noRequests')}>
            {(rows) => (
              <BarList
                items={slowest(rows).map((r) => ({
                  id: r.id,
                  label: <EndpointLabel method={r.method} route={r.route} />,
                  value: r.stats.p95LatencyMs,
                  display: tf.latency(r.stats.p95LatencyMs),
                  tone: r.status === 'slow' ? ENDPOINT_TONE.slow : undefined,
                  onClick: () => openEndpoint(r.id),
                }))}
              />
            )}
          </QueryView>
        </Panel>
        <Panel
          title={t('tr.top.errors')}
          actions={
            <Button size="xs" variant="ghost" onClick={() => go('endpoints', { sort: 'errors' })}>
              {t('tr.top.viewAll')}
            </Button>
          }
        >
          <QueryView query={endpoints} compact isEmpty={(rows) => mostErrors(rows).length === 0} emptyMessage={t('tr.top.noErrors')}>
            {(rows) => (
              <BarList
                items={mostErrors(rows).map((r) => ({
                  id: r.id,
                  label: <EndpointLabel method={r.method} route={r.route} />,
                  value: r.stats.serverErrors,
                  display: `${tf.count(r.stats.serverErrors)} · ${tf.rate(r.stats.errorRatePercent)}`,
                  tone: 'crit',
                  onClick: () => openEndpoint(r.id),
                }))}
              />
            )}
          </QueryView>
        </Panel>
      </PanelGrid>

      <Panel title={t('tr.summary24h.title')} hint={t('tr.summary24h.hint')} className="mb-4">
        <QueryView query={insights} compact skeleton="block">
          {() =>
            day ? (
              <KeyValueGrid
                columns={3}
                items={[
                  { label: t('tr.summary24h.total'), value: tf.count(day.total), mono: true },
                  { label: t('tr.summary24h.successful'), value: tf.count(day.successful), mono: true },
                  { label: t('tr.summary24h.clientErrors'), value: tf.count(day.clientErrors), mono: true },
                  {
                    label: t('tr.summary24h.serverErrors'),
                    value: <span className={day.serverErrors > 0 ? 'text-crit-fg' : undefined}>{tf.count(day.serverErrors)}</span>,
                    mono: true,
                  },
                  {
                    label: t('tr.summary24h.peak'),
                    value: day.peak ? `${tf.rps(day.peak.requestsPerSecond)} · ${formatTime(day.peak.at, false)}` : NO_VALUE,
                    mono: true,
                  },
                  {
                    label: t('tr.summary24h.slowest'),
                    value: day.slowest
                      ? `${formatTime(day.slowest.from, false)}–${formatTime(day.slowest.to, false)} · ${t('tr.col.p95')} ${tf.latency(day.slowest.p95LatencyMs)}`
                      : NO_VALUE,
                    mono: true,
                  },
                ]}
              />
            ) : null
          }
        </QueryView>
      </Panel>
    </>
  );
}
