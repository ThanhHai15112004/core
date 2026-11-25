import React, { useMemo, useState } from 'react';
import { Activity, RefreshCw, Settings2 } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { toneOf } from '@core/theme';
import { NO_VALUE } from '@core/lib/format';
import { useFormat } from '@core/hooks/useFormat';
import { ApiError } from '@core/services/api';
import { errorMessage, useLiveQuery } from '@core/data';
import { Badge, Button } from '@core/ui/primitives';
import {
  DataTable,
  KeyValueGrid,
  PageHeader,
  Panel,
  PanelGrid,
  StatGrid,
  StatTile,
  StatusBanner,
  StatusDot,
} from '@core/ui/blocks';
import { healthConsoleApi } from '../../services/health.api';
import type {
  ProviderChannelHealthDto,
  QueueHealthItemDto,
  StatelessCheckItemDto,
} from '../../types/health.types';
import { HealthSettingsSheet } from './HealthSettingsSheet';

const queueCol = createColumnHelper<QueueHealthItemDto>();
const provCol = createColumnHelper<ProviderChannelHealthDto>();
const statelessCol = createColumnHelper<StatelessCheckItemDto>();

export const HealthSection: React.FC = () => {
  const { t } = useLocale();
  const f = useFormat();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const livenessQ = useLiveQuery(
    ['console', 'health', 'live'],
    () => healthConsoleApi.getLiveness(),
    { tier: 'live' },
  );
  const readinessQ = useLiveQuery(
    ['console', 'health', 'ready'],
    () => healthConsoleApi.getReadiness(),
    { tier: 'live' },
  );
  const detailsQ = useLiveQuery(
    ['console', 'health', 'details'],
    () => healthConsoleApi.getDetails(),
    { tier: 'live' },
  );

  const isAuthDenied =
    detailsQ.isError &&
    detailsQ.error instanceof ApiError &&
    (detailsQ.error.status === 401 || detailsQ.error.status === 403);

  const details = detailsQ.data;
  const overallStatus = details?.status ?? readinessQ.data?.status ?? livenessQ.data?.status;
  const overallTone = overallStatus ? toneOf(overallStatus) : 'unknown';

  const handleRecheck = () => {
    void livenessQ.refetch();
    void readinessQ.refetch();
    void detailsQ.refetch();
  };

  const queueColumns = useMemo(
    () => [
      queueCol.accessor('name', {
        header: t('health.col.queue'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      queueCol.accessor('waiting', { header: t('health.col.waiting') }),
      queueCol.accessor('active', { header: t('health.col.active') }),
      queueCol.accessor('delayed', { header: t('health.col.delayed') }),
      queueCol.accessor('failed', {
        header: t('health.col.failed'),
        cell: (c) => (
          <Badge tone={c.getValue() > 0 ? 'warn' : 'ok'}>{c.getValue()}</Badge>
        ),
      }),
      queueCol.accessor('workers', { header: t('health.col.workers') }),
      queueCol.accessor('paused', {
        header: t('health.col.state'),
        cell: (c) => (
          <Badge tone={c.getValue() ? 'warn' : 'ok'}>
            {c.getValue() ? 'PAUSED' : 'ACTIVE'}
          </Badge>
        ),
      }),
    ],
    [t],
  );

  const providerColumns = useMemo(
    () => [
      provCol.accessor('providerType', {
        header: t('health.col.channel'),
        cell: (c) => <span className="font-mono text-xs font-semibold">{c.getValue()}</span>,
      }),
      provCol.accessor('status', {
        header: t('health.col.status'),
        cell: (c) => {
          const tone = toneOf(c.getValue());
          return (
            <Badge tone={tone}>
              <StatusDot tone={tone} size="xs" />
              {c.getValue().toUpperCase()}
            </Badge>
          );
        },
      }),
      provCol.display({
        id: 'resolved',
        header: t('health.col.resolved'),
        cell: (c) => {
          const r = c.row.original;
          return r.configured ? (r.resolvedProviderCode ?? NO_VALUE) : t('health.common.unconfigured');
        },
      }),
      provCol.display({
        id: 'counts',
        header: t('health.col.counts'),
        cell: (c) => {
          const r = c.row.original;
          return r.configured
            ? `${r.healthyCount} / ${r.degradedCount} / ${r.downCount}`
            : NO_VALUE;
        },
      }),
      provCol.display({
        id: 'fallback',
        header: t('health.col.fallback'),
        cell: (c) => {
          const r = c.row.original;
          if (!r.configured) {
            if (r.adapterReady === null) return NO_VALUE;
            return r.adapterReady ? t('health.common.adapterReady') : t('health.common.adapterDown');
          }
          return r.fallbackAvailable ? t('health.common.yes') : t('health.common.no');
        },
      }),
    ],
    [t],
  );

  const providerRows = useMemo(
    () => (details ? Object.values(details.dependencies.providers.byType) : []),
    [details],
  );

  const statelessColumns = useMemo(
    () => [
      statelessCol.accessor('key', {
        header: t('health.col.criterion'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      statelessCol.accessor('status', {
        header: t('health.col.status'),
        cell: (c) => {
          const val = c.getValue();
          const tone = val === 'pass' ? 'ok' : val === 'warn' ? 'warn' : 'crit';
          return (
            <Badge tone={tone}>
              <StatusDot tone={tone} size="xs" />
              {t(`health.statelessCheck.${val}`)}
            </Badge>
          );
        },
      }),
      statelessCol.accessor('detail', {
        header: t('health.col.detail'),
        cell: (c) => <span className="text-xs text-muted-foreground">{c.getValue()}</span>,
      }),
    ],
    [t],
  );

  const bannerReasons = useMemo(() => {
    if (!details) return [];
    return [
      ...details.criticalErrors.map((text, idx) => ({ id: `crit-${idx}`, text })),
      ...details.warnings.map((text, idx) => ({ id: `warn-${idx}`, text })),
    ];
  }, [details]);

  const db = details?.dependencies.database;
  const redis = details?.dependencies.redis;
  const queue = details?.dependencies.queue;
  const storage = details?.dependencies.storage;
  const migration = details?.dependencies.migration;
  const proc = details?.dependencies.process;

  const redisQueueTone =
    redis && queue
      ? redis.status === 'down' || queue.status === 'down'
        ? 'crit'
        : redis.status === 'degraded' || queue.status === 'degraded'
          ? 'warn'
          : 'ok'
      : 'unknown';

  return (
    <div>
      <PageHeader
        title={t('health.title')}
        icon={Activity}
        status={
          overallStatus
            ? { tone: overallTone, label: t(`console.status.${overallStatus}`) }
            : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <Button size="xs" variant="outline" onClick={handleRecheck}>
              <RefreshCw />
              {t('health.recheck')}
            </Button>
            {!isAuthDenied && (
              <Button size="xs" variant="secondary" onClick={() => setSettingsOpen(true)}>
                <Settings2 />
                {t('health.settings')}
              </Button>
            )}
          </div>
        }
      />

      {isAuthDenied && (
        <StatusBanner
          tone="warn"
          title={t('health.authRequiredTitle')}
          description={t('health.authRequiredDesc')}
        />
      )}

      {detailsQ.isError && !isAuthDenied && !details && (
        <StatusBanner
          tone="crit"
          title={t('ov.offline.title')}
          description={errorMessage(detailsQ.error)}
        />
      )}

      {details && bannerReasons.length > 0 && (
        <StatusBanner
          tone={details.criticalErrors.length > 0 ? 'crit' : 'warn'}
          title={t('health.section.warnings')}
          reasons={bannerReasons}
        />
      )}

      <StatGrid columns={6}>
        <StatTile
          label={t('health.kpi.liveness')}
          value={livenessQ.data ? (livenessQ.data.live ? 'LIVE' : 'DOWN') : NO_VALUE}
          tone={livenessQ.data ? (livenessQ.data.live ? 'ok' : 'crit') : 'unknown'}
          sub={
            livenessQ.data
              ? livenessQ.data.live
                ? t('health.kpi.liveTrue')
                : t('health.kpi.liveFalse')
              : undefined
          }
          loading={livenessQ.isPending && !livenessQ.data}
        />
        <StatTile
          label={t('health.kpi.readiness')}
          value={readinessQ.data ? (readinessQ.data.ready ? 'READY' : 'NOT READY') : NO_VALUE}
          tone={
            readinessQ.data
              ? !readinessQ.data.ready
                ? 'crit'
                : toneOf(readinessQ.data.status)
              : 'unknown'
          }
          sub={
            readinessQ.data
              ? readinessQ.data.ready
                ? t('health.kpi.readyTrue')
                : t('health.kpi.readyFalse')
              : undefined
          }
          loading={readinessQ.isPending && !readinessQ.data}
        />
        <StatTile
          label={t('health.kpi.database')}
          value={
            db
              ? db.latencyMs !== null && db.latencyMs !== undefined
                ? `${db.latencyMs} ms`
                : db.status.toUpperCase()
              : NO_VALUE
          }
          tone={db ? toneOf(db.status) : 'unknown'}
          sub={
            db
              ? t('health.kpi.timeoutSub', {
                  ms: db.timeoutMs ?? details?.settings.dbTimeoutMs ?? 2000,
                  state: db.state ?? NO_VALUE,
                })
              : undefined
          }
        />
        <StatTile
          label={t('health.kpi.redisQueue')}
          value={
            redis && queue
              ? `${redis.status.toUpperCase()} / ${queue.status.toUpperCase()}`
              : NO_VALUE
          }
          tone={redisQueueTone}
          sub={
            redis && queue
              ? t('health.kpi.redisQueueSub', {
                  redis: redis.latencyMs !== null && redis.latencyMs !== undefined ? `${redis.latencyMs}ms` : (redis.state ?? NO_VALUE),
                  queue: queue.queues.length,
                })
              : undefined
          }
        />
        <StatTile
          label={t('health.kpi.storage')}
          value={
            storage
              ? storage.latencyMs !== null && storage.latencyMs !== undefined
                ? `${storage.latencyMs} ms`
                : storage.status.toUpperCase()
              : NO_VALUE
          }
          tone={storage ? toneOf(storage.status) : 'unknown'}
          sub={
            storage
              ? t('health.kpi.storageSub', {
                  driver: storage.driver,
                  probe: storage.writeProbeEnabled ? t('health.common.on') : t('health.common.off'),
                })
              : undefined
          }
        />
        <StatTile
          label={t('health.kpi.migration')}
          value={
            migration
              ? migration.upToDate
                ? 'SYNCED'
                : `PENDING (${migration.pending})`
              : NO_VALUE
          }
          tone={migration ? toneOf(migration.status) : 'unknown'}
          sub={
            migration
              ? migration.upToDate
                ? t('health.kpi.migrationOk', {
                    applied: migration.applied,
                    total: migration.total,
                  })
                : t('health.kpi.migrationWarn', {
                    pending: migration.pending,
                    tampered: migration.tampered,
                  })
              : undefined
          }
        />
      </StatGrid>

      {details && (
        <>
          <PanelGrid layout={2}>
            <Panel title={t('health.section.process')}>
              <KeyValueGrid
                columns={2}
                items={[
                  { label: t('health.field.runtimeState'), value: proc?.runtimeState ?? NO_VALUE, mono: true },
                  {
                    label: t('health.field.eventLoopLag'),
                    value: proc ? `${proc.eventLoopLagMs} ms` : NO_VALUE,
                    mono: true,
                  },
                  {
                    label: t('health.field.heapUsage'),
                    value: proc
                      ? `${proc.heapUsedMb} / ${proc.heapLimitMb} MB (${Math.round(proc.heapRatio * 100)}%)`
                      : NO_VALUE,
                    mono: true,
                  },
                  {
                    label: t('health.field.rssMemory'),
                    value: proc ? `${proc.rssMb} MB` : NO_VALUE,
                    mono: true,
                  },
                  {
                    label: t('health.field.uptime'),
                    value: f.uptime(details.uptime),
                    mono: true,
                  },
                ]}
              />
            </Panel>

            <Panel title={t('health.section.migrationSecurity')}>
              <KeyValueGrid
                columns={2}
                items={[
                  {
                    label: t('health.field.migrationEnabled'),
                    value: migration?.enabled ? t('health.common.on') : t('health.common.off'),
                  },
                  {
                    label: t('health.field.appliedCount'),
                    value: migration ? `${migration.applied} / ${migration.total}` : NO_VALUE,
                    mono: true,
                  },
                  {
                    label: t('health.field.pendingCount'),
                    value: migration ? migration.pending : NO_VALUE,
                    mono: true,
                  },
                  {
                    label: t('health.field.tamperedCount'),
                    value: migration ? migration.tampered : NO_VALUE,
                    mono: true,
                  },
                  {
                    label: t('health.field.hidePublicDetails'),
                    value: details.settings.hidePublicDetails
                      ? t('health.common.on')
                      : t('health.common.off'),
                  },
                  {
                    label: t('health.field.failOnPendingMigration'),
                    value: details.settings.failOnPendingMigration
                      ? t('health.common.on')
                      : t('health.common.off'),
                  },
                ]}
              />
            </Panel>
          </PanelGrid>

          <PanelGrid layout={2}>
            <Panel title={t('health.section.queues')}>
              <DataTable
                data={queue?.queues ?? []}
                columns={queueColumns}
                getRowId={(r) => r.name}
                emptyMessage={t('health.common.emptyQueues')}
              />
            </Panel>

            <Panel title={t('health.section.providers')}>
              <DataTable
                data={providerRows}
                columns={providerColumns}
                getRowId={(r) => r.providerType}
                emptyMessage={t('health.common.unconfigured')}
              />
            </Panel>
          </PanelGrid>

          {details.stateless && (
            <Panel title={t('health.section.stateless')}>
              <div className="mb-4">
                <KeyValueGrid
                  columns={4}
                  items={[
                    {
                      label: t('health.field.instanceId'),
                      value: details.stateless.instanceId,
                      mono: true,
                    },
                    {
                      label: t('health.field.draining'),
                      value: details.stateless.draining ? t('health.common.on') : t('health.common.off'),
                      mono: true,
                    },
                    {
                      label: t('health.field.inFlightRequests'),
                      value: details.stateless.inFlightRequests,
                      mono: true,
                    },
                    {
                      label: t('health.field.drainDelay'),
                      value: `${details.stateless.drainDelayMs} ms`,
                      mono: true,
                    },
                    {
                      label: t('health.field.gracefulTimeout'),
                      value: `${details.stateless.gracefulTimeoutMs} ms`,
                      mono: true,
                    },
                  ]}
                />
              </div>
              <DataTable
                data={[...details.stateless.checks]}
                columns={statelessColumns}
                getRowId={(r) => r.key}
                emptyMessage={t('health.common.unconfigured')}
              />
            </Panel>
          )}
        </>
      )}

      <HealthSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
};
