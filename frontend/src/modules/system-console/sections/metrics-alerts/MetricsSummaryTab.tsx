import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { NO_VALUE } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { DataTable, Panel, StatGrid, StatTile, StatusDot } from '@core/ui/blocks';
import type {
  HttpApiMetricDto,
  InstanceResourceMetricDto,
  MetricsOverviewDto,
  ModuleErrorMetricDto,
  ProviderLatencyMetricDto,
  QueueMetricDto,
} from '../../types/metrics-alerts.types';

const epCol = createColumnHelper<HttpApiMetricDto>();
const modCol = createColumnHelper<ModuleErrorMetricDto>();
const instCol = createColumnHelper<InstanceResourceMetricDto>();
const qCol = createColumnHelper<QueueMetricDto>();
const provCol = createColumnHelper<ProviderLatencyMetricDto>();

function fmtNum(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return NO_VALUE;
  return `${v}${suffix}`;
}

export const MetricsSummaryTab: React.FC<{ data: MetricsOverviewDto }> = ({ data }) => {
  const { t } = useLocale();

  const endpointCols = useMemo(
    () => [
      epCol.accessor((r) => `${r.method} ${r.route}`, {
        id: 'endpoint',
        header: t('metricsAlerts.col.endpoint'),
        cell: (c) => <span className="font-mono text-xs text-fg">{c.getValue()}</span>,
      }),
      epCol.accessor('module', { header: t('metricsAlerts.col.module') }),
      epCol.accessor('requests', { header: t('metricsAlerts.col.requests') }),
      epCol.accessor('errors5xx', { header: t('metricsAlerts.col.errors5xx') }),
      epCol.accessor('errorRatePercent', {
        header: t('metricsAlerts.col.errorRate'),
        cell: (c) => `${c.getValue()}%`,
      }),
      epCol.display({
        id: 'latency',
        header: t('metricsAlerts.col.latencyTriple'),
        cell: (c) => {
          const r = c.row.original;
          return `${fmtNum(r.p50Ms)} / ${fmtNum(r.p95Ms)} / ${fmtNum(r.p99Ms)}`;
        },
      }),
    ],
    [t],
  );

  const moduleCols = useMemo(
    () => [
      modCol.accessor('module', { header: t('metricsAlerts.col.module') }),
      modCol.accessor('version', { header: t('metricsAlerts.col.version') }),
      modCol.accessor('requests', { header: t('metricsAlerts.col.requests') }),
      modCol.accessor('errors4xx', { header: t('metricsAlerts.col.errors4xx') }),
      modCol.accessor('errors5xx', { header: t('metricsAlerts.col.errors5xx') }),
      modCol.accessor('errorRatePercent', {
        header: t('metricsAlerts.col.errorRate'),
        cell: (c) => (
          <Badge tone={c.getValue() >= 5 ? 'crit' : c.getValue() > 0 ? 'warn' : 'ok'}>
            {`${c.getValue()}%`}
          </Badge>
        ),
      }),
      modCol.display({
        id: 'modLatency',
        header: t('metricsAlerts.col.latencyTriple'),
        cell: (c) => {
          const r = c.row.original;
          return `${fmtNum(r.p50Ms)} / ${fmtNum(r.p95Ms)} / ${fmtNum(r.p99Ms)}`;
        },
      }),
    ],
    [t],
  );

  const instanceCols = useMemo(
    () => [
      instCol.accessor('runtime', { header: t('metricsAlerts.col.runtime') }),
      instCol.accessor('instance', {
        header: t('metricsAlerts.col.instance'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      instCol.accessor('version', { header: t('metricsAlerts.col.version') }),
      instCol.accessor('cpuPercent', {
        header: t('metricsAlerts.col.cpu'),
        cell: (c) => fmtNum(c.getValue(), '%'),
      }),
      instCol.display({
        id: 'mem',
        header: t('metricsAlerts.col.memory'),
        cell: (c) => {
          const r = c.row.original;
          return `${fmtNum(r.memoryPercent, '%')} (${fmtNum(r.rssMb, ' MB')})`;
        },
      }),
      instCol.display({
        id: 'loop',
        header: t('metricsAlerts.col.eventLoop'),
        cell: (c) => {
          const r = c.row.original;
          return `${fmtNum(r.eventLoopMeanMs, ' ms')} / ${fmtNum(r.eventLoopP99Ms, ' ms')}`;
        },
      }),
      instCol.accessor('status', {
        header: t('metricsAlerts.col.status'),
        cell: (c) => (
          <Badge tone={c.getValue() === 'running' ? 'ok' : 'warn'}>
            <StatusDot tone={c.getValue() === 'running' ? 'ok' : 'warn'} size="xs" />
            {c.getValue()}
          </Badge>
        ),
      }),
    ],
    [t],
  );

  const queueCols = useMemo(
    () => [
      qCol.accessor('queue', { header: t('metricsAlerts.col.queue') }),
      qCol.display({
        id: 'backlog',
        header: t('metricsAlerts.col.backlog'),
        cell: (c) => {
          const r = c.row.original;
          return `${r.backlog} (${r.waiting}/${r.delayed})`;
        },
      }),
      qCol.display({
        id: 'activeFailed',
        header: t('metricsAlerts.col.activeFailed'),
        cell: (c) => {
          const r = c.row.original;
          return `${r.active} / ${r.failed}`;
        },
      }),
      qCol.accessor('oldestJobAgeSec', {
        header: t('metricsAlerts.col.oldestAge'),
        cell: (c) => fmtNum(c.getValue(), 's'),
      }),
    ],
    [t],
  );

  const providerCols = useMemo(
    () => [
      provCol.accessor('provider', { header: t('metricsAlerts.col.provider') }),
      provCol.accessor('source', { header: t('metricsAlerts.col.source') }),
      provCol.accessor('requests', { header: t('metricsAlerts.col.requests') }),
      provCol.accessor('errorRatePercent', {
        header: t('metricsAlerts.col.errorRate'),
        cell: (c) => `${c.getValue()}%`,
      }),
      provCol.display({
        id: 'provLat',
        header: t('metricsAlerts.col.latencyTriple'),
        cell: (c) => {
          const r = c.row.original;
          return `${fmtNum(r.p50Ms)} / ${fmtNum(r.p95Ms)} / ${fmtNum(r.p99Ms)}`;
        },
      }),
      provCol.accessor('circuitState', {
        header: t('metricsAlerts.col.circuit'),
        cell: (c) => c.getValue() ?? NO_VALUE,
      }),
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <StatGrid>
        <StatTile
          label={t('metricsAlerts.kpi.requests')}
          value={data.http.totalRequests}
          sub={t('metricsAlerts.kpi.requestsSub', {
            rps: data.http.requestsPerSecond,
            err4xx: data.http.errors4xx,
            err5xx: data.http.errors5xx,
          })}
        />
        <StatTile
          label={t('metricsAlerts.kpi.latency')}
          value={t('metricsAlerts.kpi.latencyPair', {
            p50: fmtNum(data.http.p50Ms),
            p95: fmtNum(data.http.p95Ms),
            p99: fmtNum(data.http.p99Ms),
          })}
          tone={data.http.p95Ms && data.http.p95Ms > 500 ? 'warn' : 'ok'}
        />
        <StatTile
          label={t('metricsAlerts.kpi.errorRate')}
          value={`${data.http.errorRatePercent}%`}
          tone={data.http.errorRatePercent >= 5 ? 'crit' : data.http.errorRatePercent > 1 ? 'warn' : 'ok'}
        />
        <StatTile
          label={t('metricsAlerts.kpi.dbPool')}
          value={fmtNum(data.database.utilizationPercent, '%')}
          sub={t('metricsAlerts.kpi.dbPoolSub', {
            used: fmtNum(data.database.used),
            limit: fmtNum(data.database.limit),
            waiting: fmtNum(data.database.waiting),
          })}
          tone={(data.database.utilizationPercent ?? 0) >= 85 ? 'crit' : 'ok'}
        />
        <StatTile
          label={t('metricsAlerts.kpi.redisLatency')}
          value={fmtNum(data.redis.p95Ms, ' ms')}
          sub={t('metricsAlerts.kpi.redisSub', {
            ping: fmtNum(data.redis.pingMs),
            avg: fmtNum(data.redis.avgMs),
          })}
          tone={(data.redis.p95Ms ?? 0) >= 50 ? 'warn' : 'ok'}
        />
        <StatTile
          label={t('metricsAlerts.kpi.activeAlerts')}
          value={data.activeAlerts.total}
          sub={t('metricsAlerts.kpi.activeAlertsSub', {
            crit: data.activeAlerts.critical,
            warn: data.activeAlerts.warning,
            info: data.activeAlerts.info,
          })}
          tone={data.activeAlerts.critical > 0 ? 'crit' : data.activeAlerts.warning > 0 ? 'warn' : 'ok'}
        />
      </StatGrid>

      <Panel title={t('metricsAlerts.section.moduleErrors')}>
        <DataTable
          data={data.errorsByModule}
          columns={moduleCols}
          getRowId={(r) => `${r.module}:${r.version}`}
          emptyMessage={t('metricsAlerts.empty')}
        />
      </Panel>

      <Panel title={t('metricsAlerts.section.endpoints')}>
        <DataTable
          data={data.http.byEndpoint}
          columns={endpointCols}
          getRowId={(r) => `${r.method}:${r.route}`}
          emptyMessage={t('metricsAlerts.empty')}
        />
      </Panel>

      <Panel title={t('metricsAlerts.section.instances')}>
        <DataTable
          data={data.instances}
          columns={instanceCols}
          getRowId={(r) => `${r.runtime}:${r.instance}`}
          emptyMessage={t('metricsAlerts.empty')}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('metricsAlerts.section.queues')}>
          <DataTable
            data={data.queues}
            columns={queueCols}
            getRowId={(r) => r.queue}
            emptyMessage={t('metricsAlerts.empty')}
          />
        </Panel>
        <Panel title={t('metricsAlerts.section.providers')}>
          <DataTable
            data={data.providers}
            columns={providerCols}
            getRowId={(r) => `${r.source}:${r.provider}`}
            emptyMessage={t('metricsAlerts.empty')}
          />
        </Panel>
      </div>
    </div>
  );
};
