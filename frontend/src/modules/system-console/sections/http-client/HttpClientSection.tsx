import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Network, RotateCcw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { toneOf, type Tone } from '@core/theme';
import { Badge, Button } from '@core/ui/primitives';
import {
  DataTable,
  PageHeader,
  Panel,
  QueryView,
  RelativeTime,
  StatGrid,
  StatTile,
  StatusDot,
} from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import {
  fetchHttpClientOverview,
  resetAllHttpClientCircuits,
  resetHttpClientCircuit,
} from '../../services/http-client.api';
import type {
  CircuitBreakerState,
  HttpClientRecentErrorDto,
  HttpClientServiceOverviewDto,
} from '../../types/http-client.types';

const svcCol = createColumnHelper<HttpClientServiceOverviewDto>();
const errCol = createColumnHelper<HttpClientRecentErrorDto>();

const OVERVIEW_QUERY_KEY = ['console', 'http-client', 'overview'] as const;

const CIRCUIT_TONE: Record<CircuitBreakerState, Tone> = {
  CLOSED: 'ok',
  HALF_OPEN: 'warn',
  OPEN: 'crit',
};

export const HttpClientSection: React.FC = () => {
  const { t } = useLocale();
  const f = useFormat();
  const queryClient = useQueryClient();
  const { addToast } = useConsoleData();
  const query = useLiveQuery(OVERVIEW_QUERY_KEY, fetchHttpClientOverview, { tier: 'slow' });
  const data = query.data;

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: OVERVIEW_QUERY_KEY });

  const resetOne = useMutation({
    mutationFn: (service: string) => resetHttpClientCircuit(service),
    onSuccess: (res) => {
      addToast({ type: 'success', title: t('httpClient.resetSuccess'), message: res.message });
      invalidate();
    },
    onError: (err) => {
      addToast({ type: 'error', title: t('httpClient.resetFailed'), message: errorMessage(err) });
    },
  });

  const resetAll = useMutation({
    mutationFn: () => resetAllHttpClientCircuits(),
    onSuccess: (res) => {
      addToast({ type: 'success', title: t('httpClient.resetSuccess'), message: res.message });
      invalidate();
    },
    onError: (err) => {
      addToast({ type: 'error', title: t('httpClient.resetFailed'), message: errorMessage(err) });
    },
  });

  const serviceColumns = useMemo(
    () => [
      svcCol.accessor('service', {
        header: t('httpClient.col.service'),
        cell: (c) => {
          const row = c.row.original;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-fg">{row.service}</span>
              <Badge size="xs" variant="outline">
                {t(row.configured ? 'httpClient.configuredTag' : 'httpClient.dynamicTag')}
              </Badge>
            </div>
          );
        },
        meta: { width: '20%' },
      }),
      svcCol.accessor((r) => r.circuit.state, {
        id: 'circuit',
        header: t('httpClient.col.circuit'),
        cell: (c) => {
          const state = c.getValue();
          const tone = CIRCUIT_TONE[state];
          return (
            <Badge tone={tone}>
              <StatusDot tone={tone} size="xs" />
              {t(`httpClient.circuit.${state}`)}
            </Badge>
          );
        },
        meta: { width: '10rem' },
      }),
      svcCol.display({
        id: 'policy',
        header: t('httpClient.col.policy'),
        cell: (c) => {
          const p = c.row.original.policy;
          return (
            <span className="font-mono text-xs text-muted">
              {t('httpClient.policyPair', {
                timeout: f.number(p.timeoutMs),
                retries: f.number(p.retry.maxRetries),
              })}
            </span>
          );
        },
        meta: { width: '13rem' },
      }),
      svcCol.accessor((r) => r.metrics.totalRequests, {
        id: 'requests',
        header: t('httpClient.col.requests'),
        cell: (c) => f.number(c.getValue()),
        meta: { align: 'right', mono: true, width: '7rem' },
      }),
      svcCol.accessor((r) => r.metrics.errorRatePercent, {
        id: 'errorRate',
        header: t('httpClient.col.errorRate'),
        cell: (c) => t('httpClient.percentValue', { value: f.number(c.getValue()) }),
        meta: { align: 'right', mono: true, width: '7rem' },
      }),
      svcCol.display({
        id: 'latency',
        header: t('httpClient.col.latency'),
        cell: (c) => {
          const m = c.row.original.metrics;
          return t('httpClient.latencyPair', {
            avg: f.number(m.avgDurationMs),
            p95: f.number(m.p95DurationMs),
          });
        },
        meta: { align: 'right', mono: true, width: '9rem' },
      }),
      svcCol.display({
        id: 'action',
        header: t('httpClient.col.action'),
        cell: (c) => {
          const row = c.row.original;
          const canReset = row.circuit.state !== 'CLOSED' || row.circuit.consecutiveFailures > 0;
          return (
            <Button
              variant="secondary"
              size="xs"
              disabled={!canReset || resetOne.isPending}
              onClick={(e) => {
                e.stopPropagation();
                resetOne.mutate(row.service);
              }}
            >
              <RotateCcw />
              {t('httpClient.resetOne')}
            </Button>
          );
        },
        meta: { align: 'right', width: '7rem' },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, f, resetOne.isPending],
  );

  const errorColumns = useMemo(
    () => [
      errCol.accessor('time', {
        header: t('httpClient.col.time'),
        cell: (c) => <RelativeTime value={c.getValue()} />,
        meta: { width: '7rem' },
      }),
      errCol.accessor('service', {
        header: t('httpClient.col.service'),
        meta: { width: '9rem', truncate: true },
      }),
      errCol.display({
        id: 'methodUrl',
        header: t('httpClient.col.methodUrl'),
        cell: (c) => (
          <span className="block truncate font-mono text-xs text-fg">
            {`${c.row.original.method} ${c.row.original.url}`}
          </span>
        ),
        meta: { width: '28%', className: 'max-w-0' },
      }),
      errCol.accessor('code', {
        header: t('httpClient.col.code'),
        cell: (c) => (
          <Badge tone="crit" size="xs">
            {c.row.original.status !== null ? `${c.getValue()} (${c.row.original.status})` : c.getValue()}
          </Badge>
        ),
        meta: { width: '10rem' },
      }),
      errCol.accessor('message', {
        header: t('httpClient.col.message'),
        meta: { truncate: true },
      }),
    ],
    [t],
  );

  const hasNonClosed = Boolean(data?.services.some((s) => s.circuit.state !== 'CLOSED'));
  const statusTone = data ? toneOf(data.status) : undefined;

  return (
    <div>
      <PageHeader
        title={t('httpClient.title')}
        icon={Network}
        status={data && statusTone ? { tone: statusTone, label: t(`httpClient.status.${data.status}`) } : undefined}
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasNonClosed || resetAll.isPending}
            onClick={() => resetAll.mutate()}
          >
            <RotateCcw />
            {t('httpClient.resetAll')}
          </Button>
        }
      />

      <StatGrid columns={4}>
        <StatTile
          label={t('httpClient.kpi.requests')}
          value={data ? f.number(data.totals.totalRequests) : NO_VALUE}
          sub={
            data
              ? t('httpClient.kpi.requestsSub', {
                  success: f.number(data.totals.successRequests),
                  retries: f.number(data.totals.retryCount),
                })
              : undefined
          }
          loading={query.isPending}
        />
        <StatTile
          label={t('httpClient.kpi.errorRate')}
          value={data ? t('httpClient.percentValue', { value: f.number(data.totals.errorRatePercent) }) : NO_VALUE}
          sub={
            data
              ? t('httpClient.kpi.errorRateSub', {
                  timeouts: f.number(data.totals.timeoutCount),
                  blocked: f.number(data.totals.circuitRejectedCount),
                })
              : undefined
          }
          tone={data && data.totals.errorRatePercent >= 5 ? 'warn' : undefined}
          loading={query.isPending}
        />
        <StatTile
          label={t('httpClient.kpi.latency')}
          value={
            data
              ? t('httpClient.kpi.latencyValue', {
                  avg: f.number(data.totals.avgDurationMs),
                  p95: f.number(data.totals.p95DurationMs),
                })
              : NO_VALUE
          }
          loading={query.isPending}
        />
        <StatTile
          label={t('httpClient.kpi.circuits')}
          value={data ? f.number(data.totals.openCircuits) : NO_VALUE}
          sub={
            data
              ? t('httpClient.kpi.circuitsSub', {
                  halfOpen: f.number(data.totals.halfOpenCircuits),
                  services: f.number(data.totals.serviceCount),
                })
              : undefined
          }
          tone={data && data.totals.openCircuits > 0 ? 'crit' : undefined}
          loading={query.isPending}
        />
      </StatGrid>

      <Panel title={t('httpClient.servicesTitle')} flush className="mt-4">
        <QueryView query={query} isEmpty={(d) => d.services.length === 0} emptyMessage={t('httpClient.emptyServices')}>
          {(d) => (
            <DataTable
              data={d.services}
              columns={serviceColumns}
              getRowId={(r) => r.service}
              rowTone={(r) => (r.circuit.state === 'CLOSED' ? undefined : CIRCUIT_TONE[r.circuit.state])}
              emptyMessage={t('httpClient.emptyServices')}
            />
          )}
        </QueryView>
      </Panel>

      {data && data.recentErrors.length > 0 && (
        <Panel title={t('httpClient.errorsTitle')} flush className="mt-4">
          <DataTable
            data={data.recentErrors}
            columns={errorColumns}
            getRowId={(r) => r.id}
            rowTone={() => 'crit'}
          />
        </Panel>
      )}
    </div>
  );
};
