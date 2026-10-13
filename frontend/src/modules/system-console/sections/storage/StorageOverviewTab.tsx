import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { toneOf } from '@core/theme';
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
import type { LargestObject, LifecycleRule, StorageOverview, StorageReport } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { AGE_BUCKETS, CAPACITY_THRESHOLDS, HISTORY_MIN_POINTS, STORAGE_KPI_RULES, TOP_LIST_SIZE } from '../../constants/storage';
import { ContainerTable } from '../../components/storage/ContainerTable';
import { alertTone } from '../../utils/alert-tone';
import { storageKeys } from './storage-keys';
import type { StoragePage } from './useStoragePage';

const largeCol = createColumnHelper<LargestObject>();
const ruleCol = createColumnHelper<LifecycleRule>();
type Estimate = NonNullable<Awaited<ReturnType<typeof storageApi.lifecycle>>['estimate']>[number];
const estimateCol = createColumnHelper<Estimate>();

/**
 * Tổng quan Storage: 6 chỉ số → lịch sử dung lượng + vấn đề → dung lượng / object / báo cáo → loại file / tuổi →
 * container + object lớn nhất → lifecycle. Không tự đo traffic (lean-core); dung lượng từ lần quét gần nhất.
 */
export function StorageOverviewTab({ page, query }: { page: StoragePage; query: UseQueryResult<StorageOverview> }) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const { go, goLegacy, openContainer, openObject, browseObjects } = page;
  const data = query.data;
  const usage = useLiveQuery(storageKeys.usage(), () => storageApi.usage(), { tier: 'slow' });
  const lifecycleSupported = data?.capabilities.includes('lifecycle') ?? false;
  const lifecycle = useLiveQuery(storageKeys.lifecycle(), () => storageApi.lifecycle(), { tier: 'slow', enabled: lifecycleSupported });

  const history = usage.data?.history ?? [];
  const enough = history.length >= HISTORY_MIN_POINTS;
  const series: TimeSeries[] | undefined = usage.data
    ? [
        { id: 'bytes', label: t('storage.usage.size'), color: 'series-1', area: true, points: enough ? history.map((h) => ({ t: h.t, v: h.bytes })) : [] },
        { id: 'objects', label: t('storage.usage.objects'), color: 'series-2', axis: 'right', points: enough ? history.map((h) => ({ t: h.t, v: h.objects })) : [] },
      ]
    : undefined;

  const largeCols = useMemo(
    () => [
      largeCol.accessor('key', {
        header: t('storage.object.key'),
        cell: (c) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs text-fg">{c.getValue()}</span>
            {c.row.original.large && (
              <Badge tone="warn" size="xs">
                {t('storage.usage.largeChip')}
              </Badge>
            )}
          </span>
        ),
        meta: { truncate: true },
      }),
      largeCol.accessor('kind', { header: t('storage.objects.kind'), cell: (c) => t(`storage.kind.${c.getValue()}`), meta: { width: '90px' } }),
      largeCol.accessor('size', { header: t('storage.object.size'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
    ],
    [t, f],
  );
  const ruleCols = useMemo(
    () => [
      ruleCol.accessor('id', { header: t('storage.lifecycle.name'), meta: { mono: true } }),
      ruleCol.accessor('prefix', { header: t('storage.lifecycle.prefix'), cell: (c) => c.getValue() || t('storage.lifecycle.allObjects'), meta: { mono: true } }),
      ruleCol.accessor('actions', {
        header: t('storage.lifecycle.action'),
        enableSorting: false,
        cell: (c) => c.getValue().map((a) => t(`storage.lifecycle.actionType.${a.type}`, { days: a.days ?? NO_VALUE, cls: a.storageClass ?? '' })).join(' · '),
      }),
      ruleCol.accessor('status', {
        header: t('storage.lifecycle.status'),
        cell: (c) => <Badge tone={c.getValue() === 'enabled' ? 'ok' : undefined}>{t(`storage.lifecycle.state.${c.getValue()}`)}</Badge>,
        meta: { align: 'right' },
      }),
    ],
    [t],
  );
  const estimateCols = useMemo(
    () => [
      estimateCol.accessor('rule', { header: t('storage.lifecycle.name'), meta: { mono: true } }),
      estimateCol.accessor('prefix', { header: t('storage.lifecycle.prefix'), cell: (c) => c.getValue() || t('storage.lifecycle.allObjects'), meta: { mono: true } }),
      estimateCol.accessor('objects', {
        header: t('storage.lifecycle.pastDue'),
        cell: (c) => `${f.compact(c.getValue())}${c.row.original.capped ? '+' : ''} · ${t('storage.lifecycle.olderThan', { days: c.row.original.days })}`,
        meta: { align: 'right', mono: true },
      }),
      estimateCol.accessor('bytes', { header: t('storage.lifecycle.freed'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true } }),
    ],
    [t, f],
  );

  if (!data) {
    return query.isError ? (
      <PanelState status="error" error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <StatGrid columns={6}>
        {(['used', 'objects', 'growth', 'failed', 'containers', 'uploads'] as const).map((key) => (
          <StatTile key={key} label={t(`storage.kpi.${key}`)} value={NO_VALUE} loading />
        ))}
      </StatGrid>
    );
  }

  const k = data.kpis;
  const cap = data.capacity.available ? data.capacity.data : null;
  const u = data.uploads;
  const rangeLabel = t(`ui.time.ranges.${data.range}`);
  const alerts: AlertItem[] = data.alerts.map((a) => ({
    id: a.id,
    tone: toneOf(a.severity),
    title: a.title,
    detail: a.message,
    since: a.since,
    onInspect: () => (a.tab === 'containers' && a.container ? openContainer(a.container) : goLegacy(a.tab)),
  }));
  const rules = new Set(data.alerts.map((a) => a.rule));
  const okChecks = [
    data.health.state === 'connected' ? t('storage.alerts.connected') : null,
    cap && cap.percent !== null && !rules.has('CAPACITY') ? t('storage.alerts.capacityOk') : null,
    u.failed === 0 ? t('storage.alerts.noFailedUploads') : null,
    u.stale === 0 ? t('storage.alerts.noStale') : null,
  ].filter((x): x is string => x !== null);
  const reportRow = (key: keyof StorageReport, format: (v: number | null) => string, higherIsWorse: boolean | null, compare = true): ComparisonRow => ({
    id: key,
    label: t(`storage.report.${key}`),
    current: data.report.today[key],
    previous: data.report.yesterday[key],
    format,
    higherIsWorse,
    compare,
  });

  return (
    <>
      <StatGrid columns={6}>
        <StatTile
          label={t('storage.kpi.used')}
          value={f.bytes(k.usedBytes)}
          sub={cap?.totalBytes ? t('storage.kpi.usedOf', { percent: f.percent(cap.percent), total: f.bytes(cap.totalBytes) }) : t('storage.kpi.providerManaged')}
          tone={alertTone(data.alerts, STORAGE_KPI_RULES.used) ?? undefined}
        />
        <StatTile
          label={t('storage.kpi.objects')}
          value={k.objects === null ? NO_VALUE : `${f.compact(k.objects)}${k.objectsTruncated ? '+' : ''}`}
          sub={data.growth.createdToday === null ? undefined : t('storage.kpi.createdToday', { count: f.compact(data.growth.createdToday) })}
          onClick={() => go('objects')}
        />
        <StatTile
          label={t('storage.kpi.growth')}
          value={f.signedBytes(k.growthTodayBytes)}
          sub={k.growthTodayBytes === null ? t('storage.kpi.noHistory') : t('storage.kpi.growth7d', { value: f.signedBytes(data.growth.d7Bytes) })}
          hint={t('storage.kpi.growthHint')}
          tone={alertTone(data.alerts, STORAGE_KPI_RULES.growth) ?? undefined}
        />
        <StatTile
          label={t('storage.kpi.failed')}
          value={f.number(k.failedOps)}
          hint={t('storage.kpi.failedHint', { range: rangeLabel })}
          tone={k.failedOps > 0 ? 'warn' : 'ok'}
          onClick={() => go('activity')}
        />
        <StatTile
          label={t('storage.kpi.containers')}
          value={f.number(k.containers)}
          hint={t(`storage.kpi.containersSub.${data.provider.driver}`)}
          onClick={() => go('objects')}
        />
        <StatTile
          label={t('storage.kpi.uploads')}
          value={f.number(u.active)}
          sub={t('storage.kpi.uploadsSub', { failed: f.number(u.failed), stale: u.stale === null ? NO_VALUE : f.number(u.stale) })}
          tone={alertTone(data.alerts, STORAGE_KPI_RULES.uploads) ?? (u.failed > 0 || (u.stale ?? 0) > 0 ? 'warn' : undefined)}
          onClick={() => go('uploads')}
        />
      </StatGrid>

      <PanelGrid layout="2-1">
        <MetricChart
          title={t('storage.usage.growthChart')}
          hint={t('storage.usage.historyHint')}
          series={series}
          error={usage.error}
          onRetry={() => void usage.refetch()}
          stats={
            usage.data
              ? [
                  { label: t('storage.growth.today'), value: f.signedBytes(usage.data.growth.todayBytes) },
                  { label: t('storage.growth.d7'), value: f.signedBytes(usage.data.growth.d7Bytes) },
                  { label: t('storage.growth.d30'), value: f.signedBytes(usage.data.growth.d30Bytes) },
                ]
              : undefined
          }
          format={(v) => f.bytes(v)}
          formatRight={(v) => f.compact(v)}
          legend
          emptyMessage={t('storage.usage.noHistory')}
        />
        <Panel title={t('storage.alerts.title')} actions={alerts.length > 0 ? <Badge tone={alerts.some((a) => a.tone === 'crit') ? 'crit' : 'warn'}>{alerts.length}</Badge> : undefined}>
          <AlertList items={alerts} okChecks={okChecks} emptyMessage={okChecks.length === 0 ? t('storage.alerts.none') : undefined} />
        </Panel>
      </PanelGrid>

      <PanelGrid layout={3}>
        <Panel title={t('storage.capacity.title')} hint={cap ? t(`storage.capacity.source.${cap.source ?? 'none'}`) : undefined}>
          <AvailableView source={data.capacity} messages={{ unsupported: t('storage.section.unsupported', { driver: data.provider.product }), disconnected: t('storage.section.disconnected') }}>
            {(c) => (
              <>
                <div className="mb-1 flex items-baseline gap-1.5">
                  <span className="font-mono text-xl font-semibold tabular-nums text-fg">{f.bytes(c.usedBytes ?? k.usedBytes)}</span>
                  {c.totalBytes !== null && <span className="font-mono text-sm text-muted">/ {f.bytes(c.totalBytes)}</span>}
                </div>
                {c.percent !== null ? (
                  <UsageBar percent={c.percent} thresholds={CAPACITY_THRESHOLDS} className="mb-3" />
                ) : (
                  <p className="mb-3 text-xs text-muted">{t('storage.capacity.providerManaged')}</p>
                )}
                <KeyValueGrid
                  items={[
                    { label: t('storage.capacity.percent'), value: f.percent(c.percent), mono: true },
                    {
                      label: t('storage.capacity.available'),
                      value: c.freeBytes !== null ? f.bytes(c.freeBytes) : c.totalBytes !== null && c.usedBytes !== null ? f.bytes(c.totalBytes - c.usedBytes) : null,
                      mono: true,
                    },
                  ]}
                />
              </>
            )}
          </AvailableView>
        </Panel>

        <Panel title={t('storage.usage.objectsTitle')} hint={usage.data?.truncated ? t('storage.usage.truncatedNote', { count: f.compact(usage.data.scannedObjects) }) : t('storage.usage.deletedNote')}>
          <QueryView query={usage} compact>
            {(us) => (
              <>
                <div className="mb-3 font-mono text-xl font-semibold tabular-nums text-fg">
                  {f.compact(us.totalObjects)}
                  {us.truncated ? '+' : ''}
                </div>
                <KeyValueGrid
                  items={[
                    { label: t('storage.usage.createdToday'), value: f.compact(us.growth.createdToday), mono: true },
                    { label: t('storage.usage.deletedToday'), value: f.compact(us.growth.deletedTodayEstimate), mono: true },
                    {
                      label: t('storage.usage.netChange'),
                      value: us.growth.todayObjects === null ? null : f.delta(us.growth.todayObjects, 0, ''),
                      mono: true,
                    },
                    {
                      label: t('storage.usage.scanned'),
                      value: us.usageAt ? formatTime(us.usageAt, true) : null,
                      mono: true,
                    },
                  ]}
                />
              </>
            )}
          </QueryView>
        </Panel>

        <Panel title={t('storage.report.title')}>
          <ComparisonTable
            rows={[
              reportRow('usedBytes', (v) => f.bytes(v), null),
              reportRow('growthBytes', (v) => f.signedBytes(v), null, false),
              reportRow('objects', (v) => f.compact(v), null),
              reportRow('failedOps', (v) => f.number(v), true),
            ]}
          />
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel title={t('storage.usage.byKind')}>
          <QueryView query={usage} compact isEmpty={(us) => us.byKind.every((x) => x.objects === 0)} emptyMessage={t('storage.empty')}>
            {(us) => (
              <BarList
                items={us.byKind
                  .filter((x) => x.objects > 0)
                  .sort((a, b) => b.bytes - a.bytes)
                  .map((x) => ({
                    id: x.kind,
                    label: t(`storage.kind.${x.kind}`),
                    value: x.bytes,
                    display: f.bytes(x.bytes),
                    sub: f.compact(x.objects),
                    onClick: () => browseObjects({ kind: x.kind }),
                  }))}
              />
            )}
          </QueryView>
        </Panel>
        <Panel title={t('storage.usage.byAge')}>
          <QueryView query={usage} compact>
            {(us) => (
              <BarList
                items={AGE_BUCKETS.map((b) => {
                  const a = us.byAge.find((x) => x.bucket === b);
                  return { id: b, label: t(`storage.usage.age.${b}`), value: a?.bytes ?? 0, display: f.bytes(a?.bytes ?? 0), sub: f.compact(a?.objects ?? 0) };
                })}
              />
            )}
          </QueryView>
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel
          title={t(`storage.container.title.${data.provider.driver}`)}
          hint={data.usageAt ? `${t('storage.usage.scannedAt', { time: formatTime(data.usageAt, true) })}${data.usageTruncated ? ` · ${t('storage.usage.truncated')}` : ''}` : undefined}
          flush
          actions={
            <Button size="xs" variant="ghost" onClick={() => go('objects')}>
              {t('storage.container.browseAll')}
              <ArrowRight />
            </Button>
          }
        >
          <ContainerTable rows={data.topContainers.slice(0, TOP_LIST_SIZE)} onOpen={(c) => openContainer(c.name)} emptyMessage={t('storage.empty')} compact />
        </Panel>
        <Panel title={t('storage.usage.largest')} hint={t('storage.usage.largeHint', { size: f.bytes(usage.data?.largeObjectBytes ?? data.settings.largeObjectBytes) })} flush>
          <QueryView query={usage} compact>
            {(us) => (
              <DataTable
                data={us.largest.slice(0, TOP_LIST_SIZE)}
                columns={largeCols}
                getRowId={(o) => o.key}
                onRowClick={(o) => openObject(o.key)}
                rowTone={(o) => (o.large ? 'warn' : undefined)}
                emptyMessage={t('storage.empty')}
              />
            )}
          </QueryView>
        </Panel>
      </PanelGrid>

      <Panel title={t('storage.lifecycle.title')} hint={`${t('storage.lifecycle.hint')} ${t('storage.lifecycle.estimateHint')} ${t('storage.lifecycle.activityNote')}`}>
        {!lifecycleSupported ? (
          <PanelState status="no-source" compact message={t('storage.unsupported.message', { product: data.provider.product })} />
        ) : (
          <QueryView query={lifecycle} compact>
            {(lc) => (
              <AvailableView source={lc.lifecycle} messages={{ unsupported: t('storage.section.unsupported', { driver: data.provider.product }) }}>
                {(l) => (
                  <>
                    <KeyValueGrid
                      columns={3}
                      className="mb-3"
                      items={[
                        { label: t('storage.lifecycle.versioning'), value: l.versioning ? t(`storage.lifecycle.versioningState.${l.versioning}`) : null },
                        { label: t('storage.lifecycle.objectLock'), value: l.objectLock === null ? null : l.objectLock ? t('ui.config.yes') : t('ui.config.no') },
                        { label: t('storage.lifecycle.rules'), value: f.number(l.rules.length), mono: true },
                      ]}
                    />
                    <DataTable data={l.rules} columns={ruleCols} getRowId={(r) => r.id} emptyMessage={t('storage.lifecycle.noRules')} />
                    {lc.estimate && lc.estimate.length > 0 && (
                      <>
                        <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">{t('storage.lifecycle.estimateTitle')}</h3>
                        <DataTable data={lc.estimate} columns={estimateCols} getRowId={(e) => `${e.rule}-${e.days}`} />
                      </>
                    )}
                  </>
                )}
              </AvailableView>
            )}
          </QueryView>
        )}
      </Panel>
    </>
  );
}
