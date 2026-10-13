import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight, Users } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { toneOf, type Tone } from '@core/theme';
import { CHART_GROUP, TIME_RANGE_MS } from '@core/constants/ui.constants';
import { Badge, Button } from '@core/ui/primitives';
import {
  AlertList,
  AvailableView,
  ComparisonTable,
  DataTable,
  KeyValueGrid,
  Panel,
  PanelGrid,
  PanelState,
  QueryView,
  StatGrid,
  StatTile,
  UsageBar,
  type AlertItem,
  type ComparisonRow,
} from '@core/ui/blocks';
import { BarList, MetricChart, type TimeSeries } from '@core/ui/charts';
import type { CacheMetric, CacheOverview, CacheReport, LargeKey } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import {
  CACHE_METRICS,
  CACHE_SERIES_COLOR,
  FRAGMENTATION_WARN,
  HIT_RATE_CRIT_GAP,
  HIT_RATE_DROP_WARN_POINTS,
  HIT_RATE_WINDOW_MIN,
  KPI_ALERT_RULES,
  TOP_NAMESPACES,
  TTL_BUCKETS,
  USAGE_THRESHOLDS,
} from '../../constants/cache';
import { NamespaceTable } from '../../components/cache/NamespaceTable';
import { ClientsSheet } from '../../components/cache/ClientsSheet';
import { cacheKeys } from './cache-keys';
import type { CachePage } from './useCachePage';

const runtimeCol = createColumnHelper<{ runtime: string; connections: number; blocked: number; bull: number }>();
const largeCol = createColumnHelper<LargeKey>();

/** Tông của một ô theo cảnh báo backend đang mở (rule tương ứng). */
function alertTone(data: CacheOverview, rules: readonly string[]): Tone | null {
  const hits = data.alerts.filter((a) => rules.includes(a.rule));
  return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.some((a) => a.severity === 'warning') ? 'warn' : null;
}

/**
 * Tổng quan Cache: 6 chỉ số → biểu đồ + vấn đề → hiệu quả / bộ nhớ / TTL → namespace + kết nối → key lớn + báo cáo.
 * Số liệu Redis server là của cả server (dùng chung với project khác) — ghi rõ ở ⓘ.
 */
export function CacheOverviewTab({ page, query }: { page: CachePage; query: UseQueryResult<CacheOverview> }) {
  const data = query.data;
  const { t } = useLocale();
  const f = useFormat();
  const { range, go, goLegacy, openNamespace, openKey, browseKeys } = page;
  const [metric, setMetric] = useState<CacheMetric>('hitRate');
  const [clientsOpen, setClientsOpen] = useState(false);
  const metrics = useLiveQuery(cacheKeys.metrics(range, metric), () => cacheApi.metrics(range, metric));
  const memory = useLiveQuery(cacheKeys.memory(range), () => cacheApi.memory(range), { tier: 'slow' });
  const clients = useLiveQuery(cacheKeys.clients(), () => cacheApi.clients());

  const unit = metrics.data?.series[0]?.unit ?? metrics.data?.unit ?? '';
  const series: TimeSeries[] | undefined = useMemo(
    () =>
      metrics.data?.series.map((s, i) => ({
        id: s.id,
        label: s.label,
        color: CACHE_SERIES_COLOR[s.id],
        area: i === 0,
        points: s.points.map((p) => ({ t: p.t, v: p.value })),
      })),
    [metrics.data],
  );

  const runtimeCols = useMemo(
    () => [
      runtimeCol.accessor('runtime', {
        header: t('cache.clients.runtime'),
        cell: (c) => (
          <button type="button" className="text-info-fg hover:underline" onClick={() => page.navigate(`runtimes/${c.getValue()}`)}>
            {t(`rt.name.${c.getValue()}`)}
          </button>
        ),
      }),
      runtimeCol.accessor('connections', { header: t('cache.clients.connections'), meta: { align: 'right', mono: true } }),
      runtimeCol.accessor('bull', { header: t('cache.clients.bull'), meta: { align: 'right', mono: true } }),
      runtimeCol.accessor('blocked', { header: t('cache.clients.waiting'), meta: { align: 'right', mono: true } }),
    ],
    [t, page],
  );
  const largeCols = useMemo(
    () => [
      largeCol.accessor('key', {
        header: t('cache.key.key'),
        cell: (c) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs text-fg">{c.getValue()}</span>
            {c.row.original.large && (
              <Badge tone="warn" size="xs">
                {t('cache.memory.largeKey')}
              </Badge>
            )}
          </span>
        ),
        meta: { truncate: true },
      }),
      largeCol.accessor('type', { header: t('cache.key.type'), cell: (c) => c.getValue() ?? NO_VALUE, meta: { width: '80px' } }),
      largeCol.accessor('bytes', { header: t('cache.key.size'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
      largeCol.accessor('ttlMs', {
        header: t('cache.key.ttl'),
        cell: (c) => (c.getValue() === null ? t('cache.ttl.none') : f.duration(c.getValue())),
        meta: { align: 'right', mono: true, width: '120px', className: 'whitespace-nowrap' },
      }),
    ],
    [t, f],
  );

  if (!data) return query.isError ? <PanelState status="error" error={query.error} onRetry={() => void query.refetch()} /> : <OverviewSkeleton />;

  const k = data.kpis;
  const redis = data.driver === 'redis';
  const mem = k.memory;
  const hr = data.hitRate;
  const ks = data.keyspace;
  const server = data.server.available ? data.server.data : null;
  const rangeLabel = t(`ui.time.ranges.${data.range}`);
  const hitTone: Tone =
    alertTone(data, KPI_ALERT_RULES.hitRate) ??
    (k.hitRatePercent === null
      ? 'unknown'
      : k.hitRatePercent < data.settings.hitRateWarnPercent - HIT_RATE_CRIT_GAP
        ? 'crit'
        : k.hitRatePercent < data.settings.hitRateWarnPercent
          ? 'warn'
          : 'ok');
  const spike = ks ? ks.expiringNext60s >= data.settings.expirySpikeKeys : false;

  const alerts: AlertItem[] = data.alerts.map((a) => ({
    id: a.id,
    tone: toneOf(a.severity),
    title: a.title,
    detail: a.message,
    since: a.since,
    onInspect: () => (a.tab === 'namespaces' && a.namespace ? openNamespace(a.namespace) : goLegacy(a.tab)),
  }));
  if (spike && ks && !data.alerts.some((a) => a.rule === 'EXPIRY_SPIKE')) {
    alerts.push({ id: 'expiry-spike', tone: 'warn', title: t('cache.ttl.spikeTitle'), detail: t('cache.ttl.spikeMessage', { count: f.compact(ks.expiringNext60s) }), onInspect: () => browseKeys({ ttl: 'lt1m' }) });
  }
  const rules = new Set(data.alerts.map((a) => a.rule));
  const okChecks = [
    data.health.state === 'connected' ? t('cache.alerts.connected') : null,
    !rules.has('MEMORY_PRESSURE') && mem.percent !== null ? t('cache.alerts.noMemoryPressure') : null,
    redis && !rules.has('EVICTIONS') && k.evictionsPerMin !== null ? t('cache.alerts.noEvictions') : null,
    !rules.has('HIT_RATE_LOW') && !rules.has('MISS_STORM') && hr.status === 'normal' ? t('cache.alerts.hitRateOk') : null,
  ].filter((x): x is string => x !== null);

  const memValue = mem.limitSource === 'config' ? `${f.bytes(mem.cacheBytes)} / ${f.bytes(mem.limitBytes)}` : f.bytes(mem.cacheBytes);
  const memSub =
    mem.limitSource === 'maxmemory'
      ? t('cache.kpi.memoryServerSub', { percent: f.percent(mem.percent), limit: f.bytes(mem.limitBytes) })
      : mem.limitSource === 'config'
        ? t('cache.kpi.memoryLimitSub', { percent: f.percent(mem.percent) })
        : t('cache.kpi.memoryNoLimit');

  const reportRow = (key: keyof CacheReport, format: (v: number | null) => string, higherIsWorse: boolean | null): ComparisonRow => ({
    id: key,
    label: t(`cache.report.${key}`),
    current: data.report.today[key],
    previous: data.report.yesterday[key],
    format,
    higherIsWorse,
  });

  return (
    <>
      <StatGrid columns={6}>
        <StatTile
          label={t('cache.kpi.hitRate')}
          value={f.percent(k.hitRatePercent)}
          sub={(k.hits ?? 0) + (k.misses ?? 0) > 0 ? t('cache.kpi.hitsSub', { hits: f.compact(k.hits), misses: f.compact(k.misses) }) : t('cache.kpi.noReads')}
          hint={t('cache.kpi.hitRateHint', { range: rangeLabel })}
          tone={hitTone}
          onClick={() => setMetric('hitRate')}
        />
        <StatTile
          label={t('cache.kpi.memory')}
          value={memValue}
          sub={memSub}
          tone={alertTone(data, KPI_ALERT_RULES.memory) ?? undefined}
          onClick={() => setMetric('memory')}
        />
        <StatTile
          label={t('cache.kpi.keys')}
          value={k.keys === null ? NO_VALUE : `${f.compact(k.keys)}${k.keysTruncated ? '+' : ''}`}
          sub={ks ? t('cache.kpi.keysSub', { expiring: f.compact(ks.expiring), persistent: f.compact(ks.persistent) }) : undefined}
          onClick={() => go('namespaces')}
        />
        <StatTile
          label={t('cache.kpi.ops')}
          value={f.rate(k.opsPerSec)}
          sub={t('cache.kpi.serverOps', { value: f.rate(k.serverOpsPerSec) })}
          hint={t('cache.kpi.opsHint')}
          onClick={() => setMetric('operations')}
        />
        <StatTile
          label={t('cache.kpi.evictions')}
          value={redis ? f.rate(k.evictionsPerMin, 'min') : t('cache.kpi.notApplicable')}
          sub={redis ? t('cache.kpi.inRange', { count: f.compact(k.evictedInRange) }) : t('cache.kpi.memoryDriver')}
          hint={t('cache.kpi.serverWideHint')}
          tone={alertTone(data, KPI_ALERT_RULES.evictions) ?? undefined}
          onClick={redis ? () => setMetric('evictions') : undefined}
        />
        <StatTile
          label={t('cache.kpi.connections')}
          value={k.connections === null ? (redis ? NO_VALUE : t('cache.kpi.notApplicable')) : f.number(k.connections)}
          sub={data.health.pingMs !== null ? t('cache.kpi.ping', { value: f.duration(data.health.pingMs) }) : undefined}
          hint={t('cache.kpi.connectionsHint')}
          tone={alertTone(data, KPI_ALERT_RULES.connections) ?? undefined}
          onClick={redis ? () => setClientsOpen(true) : undefined}
        />
      </StatGrid>

      <PanelGrid layout="2-1">
        <MetricChart
          title={t('cache.chart.title')}
          hint={t(metrics.data?.serverWide || metric === 'memory' ? 'cache.chart.noteServer' : 'cache.chart.note')}
          metrics={CACHE_METRICS.map((m) => ({ id: m, label: t(`cache.chart.metric.${m}`) }))}
          value={metric}
          onChange={setMetric}
          series={series}
          error={metrics.error}
          onRetry={() => void metrics.refetch()}
          format={(v) => f.metric(v, unit)}
          legend={(series?.length ?? 0) > 1}
          group={CHART_GROUP}
          emptyMessage={t('cache.chart.empty')}
          xRange={{ from: (metrics.dataUpdatedAt || Date.now()) - TIME_RANGE_MS[range], to: metrics.dataUpdatedAt || Date.now() }}
        />
        <Panel title={t('cache.alerts.title')} actions={alerts.length > 0 ? <Badge tone={alerts.some((a) => a.tone === 'crit') ? 'crit' : 'warn'}>{alerts.length}</Badge> : undefined}>
          <AlertList items={alerts} okChecks={okChecks} emptyMessage={okChecks.length === 0 ? t('cache.alerts.none') : undefined} />
        </Panel>
      </PanelGrid>

      <PanelGrid layout={3}>
        <Panel title={t('cache.effect.title')} hint={`${t('cache.effect.hint')} · ${t('cache.effect.note')}`}>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="font-mono text-xl font-semibold tabular-nums text-fg">{f.percent(hr.currentPercent)}</span>
            <Badge tone={hr.status === 'low' ? 'warn' : hr.status === 'normal' ? 'ok' : undefined}>
              {t(`cache.effect.status.${hr.status}`, { reads: f.compact(hr.reads), min: HIT_RATE_WINDOW_MIN })}
            </Badge>
          </div>
          <KeyValueGrid
            items={[
              { label: t('cache.effect.baseline'), value: f.percent(hr.baselinePercent), mono: true },
              {
                label: t('cache.effect.change'),
                value:
                  hr.changePoints === null ? null : (
                    <span className={hr.changePoints <= -HIT_RATE_DROP_WARN_POINTS ? 'text-warn-fg' : undefined}>
                      {f.delta(hr.changePoints, 1, ` ${t('cache.effect.points')}`)}
                    </span>
                  ),
                mono: true,
              },
              { label: t('cache.effect.missRate'), value: f.percent(k.missRatePercent), mono: true },
              { label: t('cache.effect.errors'), value: <span className={k.errors > 0 ? 'text-crit-fg' : undefined}>{f.number(k.errors)}</span>, mono: true },
              { label: t('cache.effect.hits'), value: f.compact(k.hits), mono: true },
              { label: t('cache.effect.misses'), value: f.compact(k.misses), mono: true },
            ]}
          />
        </Panel>

        <Panel title={t('cache.memory.title')} hint={server ? t('cache.memory.sharedNote') : t(`cache.memory.note.${data.driver}`)}>
          <div className="mb-1 font-mono text-xl font-semibold tabular-nums text-fg">{memValue}</div>
          {mem.percent !== null && <UsageBar percent={mem.percent} thresholds={USAGE_THRESHOLDS} className="mb-3" />}
          <KeyValueGrid
            items={[
              {
                label: t('cache.memory.largestNs'),
                value: data.largestNamespace ? (
                  <button type="button" className="text-left text-info-fg hover:underline" onClick={() => openNamespace(data.largestNamespace!.name)}>
                    {data.largestNamespace.name} · {f.bytes(data.largestNamespace.bytes)}
                  </button>
                ) : null,
                mono: true,
              },
              { label: t('cache.memory.policy'), value: server?.policy, mono: true },
              { label: t('cache.memory.serverUsed'), value: server ? `${f.bytes(server.usedBytes)}${server.maxBytes ? ` / ${f.bytes(server.maxBytes)}` : ''}` : null, mono: true },
              { label: t('cache.memory.peak'), value: server ? f.bytes(server.peakBytes) : null, mono: true },
              {
                label: t('cache.memory.fragmentation'),
                value: server?.fragmentationRatio == null ? null : <span className={server.fragmentationRatio >= FRAGMENTATION_WARN ? 'text-warn-fg' : undefined}>{server.fragmentationRatio}</span>,
                mono: true,
              },
              { label: t('cache.memory.available'), value: server?.maxBytes && server.usedBytes !== null ? f.bytes(server.maxBytes - server.usedBytes) : null, mono: true },
            ]}
          />
          {server && !server.maxBytes && <p className="mt-3 text-xs text-muted">{t('cache.memory.noMaxmemory')}</p>}
        </Panel>

        <Panel title={t('cache.ttl.title')} hint={t('cache.ttl.soonNote')}>
          <AvailableView source={ks ? { available: true, data: ks } : { available: false, reason: 'disconnected', message: null }} messages={{ disconnected: t('cache.section.disconnected') }}>
            {(keyspace) => (
              <>
                <BarList
                  className="mb-3"
                  items={TTL_BUCKETS.map((b) => ({
                    id: b,
                    label: t(`cache.ttl.bucket.${b}`),
                    value: keyspace.ttlDistribution[b],
                    display: f.compact(keyspace.ttlDistribution[b]),
                    tone: b === 'lt1m' && keyspace.ttlDistribution[b] > 0 ? 'warn' : b === 'none' ? 'unknown' : undefined,
                    onClick: b === 'none' ? () => browseKeys({ ttl: 'persistent' }) : b === 'lt1m' ? () => browseKeys({ ttl: 'lt1m' }) : undefined,
                  }))}
                />
                <KeyValueGrid
                  items={[
                    { label: t('cache.ttl.kpi.avgTtl'), value: keyspace.avgTtlMs === null ? null : f.duration(keyspace.avgTtlMs), mono: true },
                    { label: t('cache.ttl.kpi.soon'), value: <span className={spike ? 'text-warn-fg' : undefined}>{f.compact(keyspace.expiringNext60s)}</span>, mono: true },
                    { label: t('cache.ttl.expiredRate'), value: redis ? f.rate(k.expiredPerMin, 'min') : t('cache.kpi.notApplicable'), mono: true },
                    { label: t('cache.ttl.kpi.persistent'), value: f.compact(keyspace.persistent), mono: true },
                  ]}
                />
              </>
            )}
          </AvailableView>
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel
          title={t('cache.ns.title')}
          flush
          actions={
            <Button size="xs" variant="ghost" onClick={() => go('namespaces')}>
              {t('cache.ns.viewAll')}
              <ArrowRight />
            </Button>
          }
        >
          <NamespaceTable
            rows={data.topNamespaces.slice(0, TOP_NAMESPACES)}
            onOpen={(n) => openNamespace(n.name)}
            emptyMessage={ks?.totalKeys === 0 ? t('cache.empty.title') : t('cache.ns.empty')}
            compact
          />
        </Panel>
        <Panel
          title={t('cache.clients.byRuntime')}
          hint={t('cache.clients.blockedNote')}
          actions={
            redis ? (
              <Button size="xs" variant="ghost" onClick={() => setClientsOpen(true)}>
                <Users />
                {t('cache.clients.viewAll')}
              </Button>
            ) : undefined
          }
        >
          {!redis ? (
            <PanelState status="no-source" compact message={t('cache.unsupported.message', { driver: t(`cache.driver.${data.driver}`) })} />
          ) : (
            <QueryView query={clients} compact>
              {(c) => (
                <>
                  <DataTable data={c.byRuntime} columns={runtimeCols} getRowId={(r) => r.runtime} emptyMessage={t('cache.clients.empty')} className="mb-3" />
                  <AvailableView source={c.server}>
                    {(s) => (
                      <KeyValueGrid
                        columns={4}
                        items={[
                          { label: t('cache.clients.connected'), value: `${f.number(s.connectedClients)}${s.maxClients ? ` / ${f.compact(s.maxClients)}` : ''}`, mono: true },
                          { label: t('cache.clients.usage'), value: f.percent(s.percent, 2), mono: true },
                          { label: t('cache.clients.blocked'), value: f.number(s.blockedClients), mono: true },
                          {
                            label: t('cache.clients.rejected'),
                            value: <span className={(s.rejectedConnections ?? 0) > 0 ? 'text-warn-fg' : undefined}>{f.number(s.rejectedConnections)}</span>,
                            mono: true,
                          },
                        ]}
                      />
                    )}
                  </AvailableView>
                </>
              )}
            </QueryView>
          )}
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel title={t('cache.memory.largestKeys')} hint={t('cache.memory.largeHint', { size: f.bytes(memory.data?.largeKeyBytes ?? data.settings.largeKeyBytes) })} flush>
          <QueryView query={memory} compact>
            {(m) => (
              <DataTable
                data={m.largestKeys}
                columns={largeCols}
                getRowId={(r) => r.key}
                onRowClick={(r) => openKey(r.key)}
                rowTone={(r) => (r.large ? 'warn' : undefined)}
                emptyMessage={t('cache.memory.noSize')}
              />
            )}
          </QueryView>
        </Panel>
        <Panel title={t('cache.report.title')}>
          <ComparisonTable
            rows={[
              reportRow('hits', (v) => f.compact(v), null),
              reportRow('misses', (v) => f.compact(v), true),
              reportRow('hitRatePercent', (v) => f.percent(v), false),
              reportRow('errors', (v) => f.number(v), true),
              reportRow('peakMemoryBytes', (v) => f.bytes(v), true),
              reportRow('peakKeys', (v) => f.compact(v), null),
              ...(redis ? [reportRow('evictions', (v) => f.compact(v), true), reportRow('expired', (v) => f.compact(v), null)] : []),
            ]}
          />
        </Panel>
      </PanelGrid>

      <ClientsSheet open={clientsOpen} onOpenChange={setClientsOpen} navigate={page.navigate} />
    </>
  );
}

function OverviewSkeleton() {
  const { t } = useLocale();
  return (
    <>
      <StatGrid columns={6}>
        {(['hitRate', 'memory', 'keys', 'ops', 'evictions', 'connections'] as const).map((key) => (
          <StatTile key={key} label={t(`cache.kpi.${key}`)} value={NO_VALUE} loading />
        ))}
      </StatGrid>
      <PanelGrid layout="2-1">
        <Panel title={t('cache.chart.title')}>
          <PanelState status="loading" skeleton="chart" />
        </Panel>
        <Panel title={t('cache.alerts.title')}>
          <PanelState status="loading" />
        </Panel>
      </PanelGrid>
    </>
  );
}
