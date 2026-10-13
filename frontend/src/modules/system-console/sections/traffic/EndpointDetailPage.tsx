import { useMemo } from 'react';
import { ArrowLeft, FileSearch } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Badge, Button } from '@core/ui/primitives';
import { Panel, PanelGrid, PanelState, QueryView, StatGrid, StatTile, StatusBanner } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { EndpointDetail, TrafficFilters, TrafficSettings } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { ENDPOINT_TONE } from '../../constants/traffic';
import { TrafficChart } from '../../components/traffic/TrafficChart';
import { EndpointStatusBadge, MethodBadge } from '../../components/traffic/TrafficBadges';
import { useTrafficFormat } from '../../components/traffic/useTrafficFormat';
import { formatRps, httpStatusTone, statDelta } from '../../utils/traffic-format';
import { trafficKeys } from './traffic-keys';
import type { TrafficPage } from './useTrafficPage';

/**
 * Chi tiết một endpoint trên một trang: số chính (so với kỳ trước) → latency → status code → lỗi.
 * Trong một endpoint, bộ lọc method / nội bộ không còn ý nghĩa — chỉ giữ khoảng thời gian.
 */
export function EndpointDetailPage({ page, routeId, settings }: { page: TrafficPage; routeId: string; settings: TrafficSettings | undefined }) {
  const { t } = useLocale();
  const { range, go } = page;
  const filters = useMemo<TrafficFilters>(() => ({ range, internal: true }), [range]);
  const query = useLiveQuery(trafficKeys.endpoint(routeId, range), () => trafficApi.endpoint(routeId, filters), { keepPrevious: false });

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => go('endpoints')}>
        <ArrowLeft />
        {t('tr.endpoint.back')}
      </Button>
      {query.data ? (
        <EndpointBody d={query.data} page={page} filters={filters} settings={settings} />
      ) : (
        <Panel title={<span className="font-mono">{routeId}</span>}>
          <QueryView query={query}>{() => null}</QueryView>
        </Panel>
      )}
    </>
  );
}

function EndpointBody({
  d,
  page,
  filters,
  settings,
}: {
  d: EndpointDetail;
  page: TrafficPage;
  filters: TrafficFilters;
  settings: TrafficSettings | undefined;
}) {
  const { t } = useLocale();
  const tf = useTrafficFormat();
  const s = d.stats;
  const tone = ENDPOINT_TONE[d.status];
  const logs = (status?: string) => page.openLogs({ endpoint: d.route, ...(status ? { status } : {}) });
  const pp = t('tr.unit.pp');
  const p95Slow = s.p95LatencyMs !== null && (settings ? s.p95LatencyMs > settings.endpointP95WarnMs : d.status === 'slow');

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <MethodBadge method={d.method} />
        <h2 className="min-w-0 break-all font-mono text-base font-semibold text-fg">{d.route}</h2>
        <EndpointStatusBadge status={d.status} />
        {d.internal && <Badge size="xs">{t('tr.internal')}</Badge>}
        <span className="text-xs text-muted">
          {t('tr.col.module')}: <span className="font-mono text-fg-2">{d.module}</span>
        </span>
        <Button size="sm" className="ml-auto" onClick={() => logs()}>
          <FileSearch />
          {t('tr.openLogs')}
        </Button>
      </div>

      {d.status !== 'healthy' && d.reasons.length > 0 && (
        <StatusBanner tone={tone} title={t(`tr.endpointStatus.${d.status}`)} reasons={d.reasons.map((r) => ({ id: r.code, text: r.message }))} />
      )}

      <StatGrid columns={5}>
        <StatTile
          wrap
          label={t('tr.kpi.rate')}
          value={formatRps(s.requestsPerSecond)}
          unit={t('tr.unit.rps')}
          delta={statDelta(d.comparison.requestsPercent, null)}
          hint={t('tr.endpoint.deltaHint')}
        />
        <StatTile
          wrap
          label={t('tr.kpi.requestsRange', {
            range: t(`ui.time.ranges.${d.range}`),
          })}
          value={tf.count(s.requests)}
          sub={t('tr.kpi.todayValue', { count: tf.count(d.requestsToday) })}
        />
        <StatTile wrap label={t('tr.kpi.p50')} value={tf.latency(s.p50LatencyMs)} sub={t('tr.kpi.avg', { value: tf.latency(s.avgLatencyMs) })} />
        <StatTile
          wrap
          label={t('tr.kpi.p95')}
          value={tf.latency(s.p95LatencyMs)}
          sub={t('tr.kpi.p99', { value: tf.latency(s.p99LatencyMs) })}
          tone={s.p95LatencyMs === null ? undefined : p95Slow ? 'warn' : 'ok'}
          delta={statDelta(d.comparison.p95Percent, true)}
        />
        <StatTile
          wrap
          label={t('tr.kpi.errorRate')}
          value={tf.rate(s.errorRatePercent)}
          sub={t('tr.kpi.errorDetail', {
            server: tf.count(s.serverErrors),
            client: tf.count(s.clientErrors),
            rate: tf.rate(s.clientErrorRatePercent),
          })}
          tone={s.requests === 0 ? undefined : s.serverErrors > 0 ? tone : 'ok'}
          delta={statDelta(d.comparison.errorRateDelta, true, ` ${pp}`)}
          onClick={s.serverErrors + s.clientErrors > 0 ? () => logs(s.serverErrors > 0 ? '5xx' : '4xx') : undefined}
        />
      </StatGrid>

      <TrafficChart
        title={t('tr.chart.latency')}
        filters={filters}
        routeId={d.id}
        metrics={['latency']}
        latencyThresholdMs={settings?.endpointP95WarnMs}
        className="mb-4"
      />

      <PanelGrid layout="2-1">
        <TrafficChart title={t('tr.chart.status')} filters={filters} routeId={d.id} metrics={['status']} />
        <Panel title={t('tr.status.top')} hint={t('tr.status.hint')}>
          {d.topStatuses.length === 0 ? (
            <PanelState status="empty" message={t('tr.status.empty')} compact />
          ) : (
            <BarList
              items={d.topStatuses.map((x) => ({
                id: String(x.status),
                label: <span className="font-mono">{x.status}</span>,
                value: x.count,
                display: tf.count(x.count),
                tone: httpStatusTone(x.status),
                onClick: () => logs(String(x.status)),
              }))}
            />
          )}
        </Panel>
      </PanelGrid>

      <TrafficChart
        title={t('tr.chart.errors')}
        filters={filters}
        routeId={d.id}
        metrics={['errors']}
        className="mb-4"
        actions={
          s.serverErrors > 0 ? (
            <Button size="xs" variant="ghost" onClick={() => logs('5xx')}>
              <FileSearch />
              {t('tr.endpoint.errorLogs')}
            </Button>
          ) : undefined
        }
      />
    </>
  );
}
