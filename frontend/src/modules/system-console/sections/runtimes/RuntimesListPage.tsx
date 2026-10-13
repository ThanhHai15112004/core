import { useMemo } from 'react';
import { Cpu, FileText, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { toneOf, worstTone, type Tone } from '@core/theme';
import { Button } from '@core/ui/primitives';
import { ActivityFeed, PageHeader, Panel, PanelGrid, PanelState, StatGrid, StatTile, StatusBanner, type BannerReason } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { RuntimeId, RuntimesOverview } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { EVENTS_MAX_HEIGHT_PX, LIST_EVENTS_LIMIT } from '../../constants/runtime-metrics';
import { RuntimeCard } from '../../components/runtimes/RuntimeCard';
import { CliCard, CliSheet } from '../../components/runtimes/CliRuntime';
import { RuntimeMetricChart } from '../../components/runtimes/RuntimeMetricChart';
import { eventToActivity } from '../../components/runtimes/runtime-view';
import { runtimesKeys } from './runtimes-keys';
import type { RuntimesPage } from './useRuntimesPage';

const SKELETON_CARDS = 4;

/** Danh sách runtime: sức khoẻ chung → thẻ từng runtime (kể cả CLI) → biểu đồ so sánh tài nguyên → sự kiện. */
export function RuntimesListPage({ page }: { page: RuntimesPage }) {
  const { t } = useLocale();
  const f = useFormat();
  const overview = useLiveQuery(runtimesKeys.overview(), () => runtimesApi.overview());
  const events = useLiveQuery(runtimesKeys.events(LIST_EVENTS_LIMIT), () => runtimesApi.events(LIST_EVENTS_LIMIT));
  const data = overview.data;
  const s = data?.summary;
  const runtimes = useMemo(() => data?.runtimes ?? [], [data]);
  const names = useMemo(() => Object.fromEntries(runtimes.map((r) => [r.id, r.name])) as Partial<Record<RuntimeId, string>>, [runtimes]);

  const reasons: BannerReason[] = runtimes.flatMap((r) => {
    const alerts = r.alerts.map((a) => ({ id: `${r.id}-${a.key}`, text: `${r.name}: ${a.message}`, onClick: () => page.open(r.id) }));
    const tone = toneOf(r.status);
    const other =
      tone === 'warn' || tone === 'crit'
        ? r.reasons.filter((x) => !r.alerts.some((a) => x.code === `alert.${a.key}`)).map((x) => ({ id: `${r.id}-${x.code}`, text: `${r.name}: ${x.message}`, onClick: () => page.open(r.id) }))
        : [];
    return [...alerts, ...other];
  });
  const statusTone: Tone | undefined = s ? (s.down > 0 ? 'crit' : s.warnings > 0 ? 'warn' : s.running === s.total ? 'ok' : 'unknown') : undefined;
  const bannerTone = worstTone(runtimes.map((r) => toneOf(r.status)).filter((x) => x === 'warn' || x === 'crit')) ?? 'warn';

  return (
    <div>
      <PageHeader
        title={t('nav.runtimes')}
        icon={Cpu}
        status={s && statusTone ? { tone: statusTone, label: t('rt.list.running', { running: s.running, total: s.total }) } : undefined}
        actions={
          <Button size="sm" onClick={() => page.navigate('logs/explorer')}>
            <FileText />
            {t('rt.list.allLogs')}
          </Button>
        }
      />

      {overview.isError && !data && (
        <StatusBanner
          tone="crit"
          title={t('ov.offline.title')}
          description={overview.error instanceof Error ? overview.error.message : undefined}
          actions={
            <Button size="xs" onClick={() => void overview.refetch()}>
              <RefreshCw />
              {t('ui.state.retry')}
            </Button>
          }
        />
      )}
      {data && !data.telemetry.available && <StatusBanner tone="crit" title={t('rt.noTelemetry')} description={data.telemetry.reason} />}
      {reasons.length > 0 && <StatusBanner tone={bannerTone} title={t('rt.list.issues', { count: reasons.length })} reasons={reasons} />}

      <StatGrid columns={6}>
        <StatTile label={t('rt.summary.running')} value={s ? `${s.running} / ${s.total}` : NO_VALUE} tone={s ? (s.running === s.total ? 'ok' : 'warn') : undefined} loading={!s && overview.isPending} />
        <StatTile label={t('rt.summary.warnings')} value={f.number(s?.warnings)} tone={s ? (s.warnings > 0 ? 'warn' : 'ok') : undefined} loading={!s && overview.isPending} />
        <StatTile label={t('rt.summary.down')} value={f.number(s?.down)} tone={s ? (s.down > 0 ? 'crit' : 'ok') : undefined} loading={!s && overview.isPending} />
        <StatTile label={t('rt.summary.restartsToday')} value={f.number(s?.restartsToday)} loading={!s && overview.isPending} />
        <StatTile label={t('rt.summary.totalCpu')} value={f.percent(s?.totalCpuPercent)} hint={t('rt.summary.totalCpuHint')} loading={!s && overview.isPending} />
        <StatTile
          label={t('rt.summary.totalMemory')}
          value={f.mb(s?.totalMemoryMb)}
          sub={s?.totalMemoryLimitMb ? t('rt.summary.ofLimit', { limit: f.mb(s.totalMemoryLimitMb) }) : undefined}
          loading={!s && overview.isPending}
        />
      </StatGrid>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {data
          ? [
              ...runtimes.map((r) => <RuntimeCard key={r.id} runtime={r} thresholds={data.thresholds} onOpen={() => page.open(r.id)} navigate={page.navigate} />),
              <CliCard key="cli" cli={data.cli} onOpen={() => page.openItem('cli')} />,
            ]
          : overview.isError
            ? [
                <div key="error" className="col-span-full rounded-lg border border-border bg-panel">
                  <PanelState status="error" error={overview.error} onRetry={() => void overview.refetch()} compact />
                </div>,
              ]
            : Array.from({ length: SKELETON_CARDS }, (_, i) => (
                <div key={i} className="rounded-lg border border-border bg-panel p-3">
                  <PanelState status="loading" skeleton="block" />
                </div>
              ))}
      </div>

      <PanelGrid layout="2-1">
        <RuntimeMetricChart names={names} />
        <Panel title={t('rt.distribution.title')} hint={t('rt.distribution.hint')}>
          <MemoryShare data={data} error={overview.isError ? overview.error : undefined} onRetry={() => void overview.refetch()} />
        </Panel>
      </PanelGrid>

      <Panel
        title={t('rt.events.title')}
        actions={
          <Button size="xs" variant="ghost" onClick={() => page.navigate('logs/explorer')}>
            {t('rt.logs.openViewer')}
          </Button>
        }
      >
        {events.data ? (
          <ActivityFeed items={events.data.map((e) => eventToActivity(e, true))} emptyMessage={t('rt.events.empty')} maxHeight={EVENTS_MAX_HEIGHT_PX} />
        ) : (
          <PanelState status={events.isError ? 'error' : 'loading'} error={events.error} onRetry={() => void events.refetch()} />
        )}
      </Panel>

      <CliSheet cli={data?.cli ?? null} open={page.item === 'cli'} onOpenChange={(o) => !o && page.openItem(null)} />
    </div>
  );
}

/** Tỷ trọng RSS của từng runtime trên tổng. */
function MemoryShare({ data, error, onRetry }: { data: RuntimesOverview | undefined; error?: unknown; onRetry: () => void }) {
  const { t } = useLocale();
  const f = useFormat();
  if (!data) return <PanelState status={error ? 'error' : 'loading'} error={error} onRetry={onRetry} compact />;
  const withMem = data.runtimes.filter((r) => r.resources);
  const total = withMem.reduce((sum, r) => sum + (r.resources?.rssMb ?? 0), 0);
  if (total === 0) return <PanelState status="empty" message={t('rt.noTelemetry')} compact />;
  return (
    <>
      <div className="mb-3 font-mono text-xl font-semibold tabular-nums text-fg">{f.mb(total)}</div>
      <BarList
        items={withMem.map((r) => {
          const mb = r.resources?.rssMb ?? 0;
          return { id: r.id, label: r.name, value: mb, display: `${f.mb(mb)} · ${f.percent((mb / total) * 100, 0)}` };
        })}
      />
    </>
  );
}
