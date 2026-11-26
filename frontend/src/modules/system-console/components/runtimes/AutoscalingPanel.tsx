import { useMemo, useState } from 'react';
import { FileCode2 } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import type { Tone } from '@core/theme';
import { Badge, Button } from '@core/ui/primitives';
import {
  CodeBlock,
  DataTable,
  DetailSection,
  DetailSheet,
  KeyValueGrid,
  Panel,
  PanelState,
  StatusBanner,
  StatusDot,
} from '@core/ui/blocks';
import { runtimesApi } from '../../services/runtimes.api';
import { runtimesKeys } from '../../sections/runtimes/runtimes-keys';
import type { AutoscalingTarget, AutoscalingWorkloadStatus } from '../../types/runtime.types';

const col = createColumnHelper<AutoscalingWorkloadStatus>();

const HPA_MAX_HEIGHT_PX = 460;

/** Bảng trạng thái Autoscaling (API & Worker), ngân sách DB connection pool và xem nhanh K8s HPA YAML. */
export function AutoscalingPanel() {
  const { t } = useLocale();
  const f = useFormat();
  const [hpaTarget, setHpaTarget] = useState<AutoscalingTarget | null>(null);

  const query = useLiveQuery(runtimesKeys.autoscaling(), () => runtimesApi.autoscaling());
  const hpaQuery = useLiveQuery(
    runtimesKeys.autoscalingHpa(hpaTarget ?? 'api'),
    () => runtimesApi.autoscalingHpa(hpaTarget ?? 'api'),
    { enabled: hpaTarget !== null },
  );

  const data = query.data;
  const rows = useMemo(
    () => (data ? [data.workloads.api, data.workloads.worker] : []),
    [data],
  );

  const columns = useMemo(
    () => [
      col.accessor('target', {
        header: t('rt.autoscaling.col.workload'),
        cell: (c) => <span className="font-medium text-fg">{t(`rt.name.${c.getValue()}`)}</span>,
      }),
      col.display({
        id: 'replicas',
        header: t('rt.autoscaling.col.replicas'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <span className="font-mono text-xs tabular-nums">
              {r.activeInstances} ({r.policy.minReplicas}–{r.policy.maxReplicas})
            </span>
          );
        },
      }),
      col.display({
        id: 'resources',
        header: t('rt.autoscaling.col.resources'),
        cell: (c) => {
          const m = c.row.original.metrics;
          return (
            <span className="font-mono text-xs tabular-nums">
              {f.percent(m.avgCpuPercent)} / {f.percent(m.avgMemoryPercent)}
            </span>
          );
        },
      }),
      col.display({
        id: 'loadSignal',
        header: t('rt.autoscaling.col.loadSignal'),
        cell: (c) => {
          const r = c.row.original;
          const isApi = r.target === 'api';
          const value = isApi ? r.metrics.inFlightRequests : r.metrics.queueBacklogTotal;
          const target = isApi ? r.policy.targetInFlightPerInstance : r.policy.targetBacklogPerInstance;
          return (
            <div className="flex flex-col">
              <span className="font-mono text-xs tabular-nums">
                {value !== null && value !== undefined ? f.number(value) : NO_VALUE}
              </span>
              {target !== undefined && (
                <span className="text-2xs text-muted">
                  {t(isApi ? 'rt.autoscaling.targetInFlight' : 'rt.autoscaling.targetBacklog', { target })}
                </span>
              )}
            </div>
          );
        },
      }),
      col.display({
        id: 'cooldown',
        header: t('rt.autoscaling.col.cooldown'),
        cell: (c) => {
          const p = c.row.original.policy;
          return (
            <span className="font-mono text-xs tabular-nums">
              {p.scaleUpCooldownSec}s / {p.scaleDownCooldownSec}s
            </span>
          );
        },
      }),
      col.display({
        id: 'recommendation',
        header: t('rt.autoscaling.col.recommendation'),
        cell: (c) => {
          const d = c.row.original.decision;
          const tone: Tone = d.action === 'scale_up' ? 'warn' : d.action === 'scale_down' ? 'info' : 'ok';
          return (
            <Badge tone={tone}>
              <StatusDot tone={tone} size="xs" />
              {t(`rt.autoscaling.action.${d.action}`, { count: d.recommendedReplicas })}
            </Badge>
          );
        },
      }),
      col.display({
        id: 'hpa',
        header: t('rt.autoscaling.col.hpa'),
        cell: (c) => (
          <Button size="xs" variant="outline" onClick={() => setHpaTarget(c.row.original.target)}>
            <FileCode2 />
            {t('rt.autoscaling.viewHpa')}
          </Button>
        ),
      }),
    ],
    [f, t],
  );

  const dbRiskTone: Tone = data ? data.databaseImpact.risk : 'unknown';

  return (
    <>
      <Panel
        title={t('rt.autoscaling.title')}
        hint={t('rt.autoscaling.hint')}
        actions={
          data && (
            <Badge tone={dbRiskTone}>
              <StatusDot tone={dbRiskTone} size="xs" />
              {t(`rt.autoscaling.dbRisk.${data.databaseImpact.risk}`)}
            </Badge>
          )
        }
      >
        {!data ? (
          <PanelState
            status={query.isError ? 'error' : 'loading'}
            error={query.error}
            onRetry={() => void query.refetch()}
            compact
          />
        ) : (
          <div className="space-y-3">
            {data.databaseImpact.risk !== 'ok' && (
              <StatusBanner
                tone={data.databaseImpact.risk}
                title={t(`rt.autoscaling.dbRisk.${data.databaseImpact.risk}`)}
                description={data.databaseImpact.message}
              />
            )}

            <KeyValueGrid
              columns={3}
              items={[
                {
                  label: t('rt.autoscaling.configSource'),
                  value:
                    data.configSource === 'settings_override'
                      ? t('rt.autoscaling.sourceSettings', { count: data.overriddenKeys.length })
                      : t('rt.autoscaling.sourceEnv'),
                },
                {
                  label: t('rt.autoscaling.dbPoolBudget'),
                  value: `${data.databaseImpact.maxProjectedConnections} / ${data.databaseImpact.maxConnectionsBudget} (${data.databaseImpact.maxBudgetPercent}%)`,
                  mono: true,
                },
                {
                  label: t('rt.autoscaling.dbPoolObserved'),
                  value:
                    data.databaseImpact.observedPoolUsed !== null
                      ? `${data.databaseImpact.observedPoolUsed} / ${data.databaseImpact.observedPoolWaiting ?? 0}`
                      : NO_VALUE,
                  mono: true,
                },
              ]}
            />

            <DataTable data={rows} columns={columns} getRowId={(r) => r.target} />
          </div>
        )}
      </Panel>

      <DetailSheet
        open={hpaTarget !== null}
        onOpenChange={(open) => !open && setHpaTarget(null)}
        title={hpaTarget ? t('rt.autoscaling.hpaTitle', { name: t(`rt.name.${hpaTarget}`) }) : ''}
        subtitle={
          hpaQuery.data
            ? t('rt.autoscaling.hpaSubtitle', {
                min: hpaQuery.data.policy.minReplicas,
                max: hpaQuery.data.policy.maxReplicas,
                up: hpaQuery.data.policy.scaleUpCooldownSec,
                down: hpaQuery.data.policy.scaleDownCooldownSec,
              })
            : undefined
        }
        width="lg"
      >
        {hpaQuery.data ? (
          <DetailSection title={hpaQuery.data.filename} hint={t('rt.autoscaling.hpaNote')}>
            <CodeBlock code={hpaQuery.data.yaml} maxHeight={HPA_MAX_HEIGHT_PX} />
          </DetailSection>
        ) : (
          <PanelState
            status={hpaQuery.isError ? 'error' : 'loading'}
            error={hpaQuery.error}
            onRetry={() => void hpaQuery.refetch()}
          />
        )}
      </DetailSheet>
    </>
  );
}
