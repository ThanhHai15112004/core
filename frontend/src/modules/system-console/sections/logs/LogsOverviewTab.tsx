import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import {
  AlertList,
  ComparisonTable,
  DataTable,
  KeyValueGrid,
  Panel,
  PanelGrid,
  PanelState,
  QueryView,
  StatGrid,
  StatTile,
  StatusBanner,
  type AlertItem,
  type ComparisonRow,
} from '@core/ui/blocks';
import { BarList, StackedBarChart, type TimeSeries } from '@core/ui/charts';
import type { LogFilters, LogIssue, LogsOverview, LogsSeries } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { ISSUE_TONE, TOP_LIST_SIZE } from '../../constants/logs';
import { ErrorGroupTable } from '../../components/logs/ErrorGroupTable';
import { AuditTable } from '../../components/logs/AuditTable';
import { logsKeys } from './logs-keys';
import type { LogsPage } from './useLogsPage';

type VolumeMode = 'all' | 'errors' | 'warnings';
const MODE_LEVELS: Record<VolumeMode, (keyof Omit<LogsSeries['points'][number], 't'>)[]> = {
  all: ['fatal', 'error', 'warn', 'info', 'debug'],
  errors: ['fatal', 'error'],
  warnings: ['warn'],
};
const MODE_FILTER: Record<VolumeMode, string | undefined> = { all: undefined, errors: 'error,fatal', warnings: 'warn' };
const ERROR_RATE_WARN = 5;
type Source = LogsOverview['sources'][number];
const srcCol = createColumnHelper<Source>();

/** Tổng quan Logs: số liệu chính, hoạt động log theo level, vấn đề hiện tại, nguồn / level / module, nhóm lỗi, audit, báo cáo. */
export function LogsOverviewTab({ page, data }: { page: LogsPage; data: LogsOverview | undefined }) {
  const { t } = useLocale();
  const f = useFormat();
  const { range, explore, openError, go, navigate, setSettings } = page;
  const [mode, setMode] = useState<VolumeMode>('all');
  const series = useLiveQuery(logsKeys.series(range), () => logsApi.series(range));
  const report = useLiveQuery(logsKeys.report(), () => logsApi.report(), { tier: 'slow' });
  const k = data?.kpis;

  const chartSeries: TimeSeries[] = useMemo(
    () =>
      MODE_LEVELS[mode].map((lvl) => ({
        id: lvl,
        label: lvl.toUpperCase(),
        color: `level-${lvl}` as const,
        points: (series.data?.points ?? []).map((p) => ({ t: Date.parse(p.t), v: p[lvl] })),
      })),
    [series.data, mode],
  );

  const openIssue = (i: LogIssue) => {
    if (!i.target) return;
    if (i.target.kind === 'explorer') explore(i.target.query as LogFilters);
    else if (i.target.kind === 'error') openError(i.target.fingerprint);
    else setSettings(true);
  };
  const issues: AlertItem[] = (data?.issues ?? [])
    .filter((i) => i.severity !== 'ok')
    .map((i, idx) => ({ id: `${i.key}-${idx}`, tone: ISSUE_TONE[i.severity], title: t(i.key, i.params), onInspect: i.target ? () => openIssue(i) : undefined }));
  const okIssues = (data?.issues ?? []).filter((i) => i.severity === 'ok').map((i) => t(i.key, i.params));

  const sourceCols = useMemo(
    () => [
      srcCol.accessor('runtime', {
        header: t('logs.sources.source'),
        cell: (c) => (
          <button type="button" className="text-info-fg hover:underline" onClick={(e) => (e.stopPropagation(), explore({ runtime: c.getValue() }))}>
            {t(`rt.name.${c.getValue()}`)}
            {c.row.original.instances > 1 && <span className="ml-1.5 text-2xs text-faint">{t('logs.sources.instances', { count: c.row.original.instances })}</span>}
          </button>
        ),
      }),
      srcCol.accessor('perMin', { header: t('logs.sources.perMin'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true } }),
      srcCol.accessor('errors', {
        header: t('logs.sources.errors'),
        cell: (c) =>
          c.getValue() > 0 ? (
            <button type="button" className="text-crit-fg hover:underline" onClick={(e) => (e.stopPropagation(), explore({ runtime: c.row.original.runtime, level: 'error,fatal' }))}>
              {f.compact(c.getValue())}
            </button>
          ) : (
            <span className="text-faint">0</span>
          ),
        meta: { align: 'right', mono: true },
      }),
      srcCol.accessor('warnings', { header: t('logs.sources.warnings'), cell: (c) => <span className={c.getValue() ? 'text-warn-fg' : 'text-faint'}>{f.compact(c.getValue())}</span>, meta: { align: 'right', mono: true } }),
    ],
    [t, f, explore],
  );

  const r = report.data;
  const moduleLabel = (m: string) => (m === '_none' ? t('logs.modules.none') : m === '_other' ? t('logs.modules.other') : m);

  return (
    <>
      {data && data.levelsActive.length > 0 && (
        <StatusBanner
          tone="warn"
          title={t('logs.page.overrideActive')}
          reasons={data.levelsActive.map((a) => ({
            id: a.runtime,
            text: `${t('logs.pipeline.levelOverride', { runtime: t(`rt.name.${a.runtime}`) })}: ${a.level}${a.modules.length ? ` (${a.modules.join(', ')})` : ''}`,
            onClick: () => setSettings(true),
          }))}
        />
      )}

      <StatGrid columns={6}>
        <StatTile label={t('logs.kpi.perMin')} value={f.compact(k?.logsPerMin)} hint={t('logs.kpi.perMinSub')} loading={!k} onClick={() => go('explorer')} />
        <StatTile
          label={t('logs.kpi.errors')}
          value={f.compact(k?.errors)}
          sub={t('logs.kpi.errorsSub', { count: f.compact(k?.fatal) })}
          tone={k ? ((k.errors ?? 0) > 0 ? 'crit' : 'ok') : undefined}
          loading={!k}
          onClick={() => explore({ level: 'error,fatal' })}
        />
        <StatTile
          label={t('logs.kpi.warnings')}
          value={f.compact(k?.warnings)}
          hint={t('logs.kpi.warningsSub')}
          tone={k ? ((k.warnings ?? 0) > 0 ? 'warn' : 'ok') : undefined}
          loading={!k}
          onClick={() => explore({ level: 'warn' })}
        />
        <StatTile
          label={t('logs.kpi.errorRate')}
          value={k?.errorRatePercent === null || k?.errorRatePercent === undefined ? NO_VALUE : f.percent(k.errorRatePercent)}
          hint={t('logs.kpi.errorRateSub')}
          tone={k?.errorRatePercent === null || k?.errorRatePercent === undefined ? undefined : k.errorRatePercent >= ERROR_RATE_WARN ? 'warn' : 'ok'}
          loading={!k}
        />
        <StatTile label={t('logs.kpi.unique')} value={k ? String(k.uniqueErrors) : NO_VALUE} hint={t('logs.kpi.uniqueSub')} tone={k ? (k.uniqueErrors > 0 ? 'warn' : 'ok') : undefined} loading={!k} onClick={() => go('errors')} />
        <StatTile
          label={t('logs.kpi.dropped')}
          value={f.compact(k?.dropped)}
          hint={t('logs.kpi.droppedSub')}
          tone={k?.dropped === null || k?.dropped === undefined ? undefined : k.dropped > 0 ? 'crit' : 'ok'}
          loading={!k}
          onClick={() => setSettings(true)}
        />
      </StatGrid>

      <PanelGrid layout="2-1">
        <Panel
          title={t('logs.chart.title')}
          hint={t('logs.page.volumeHint', { sec: series.data?.bucketSec ?? 60 })}
          expandable
          actions={
            <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as VolumeMode)}>
              {(['all', 'errors', 'warnings'] as VolumeMode[]).map((m) => (
                <ToggleGroupItem key={m} value={m}>
                  {t(`logs.chart.mode.${m}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          }
        >
          {series.data?.spike && (
            <StatusBanner
              tone="warn"
              className="mb-3"
              title={t('logs.chart.spike', { time: new Date(series.data.spike.at).toLocaleTimeString(), before: series.data.spike.beforePerMin, after: series.data.spike.afterPerMin })}
            />
          )}
          <QueryView query={series} skeleton="chart">
            {(s) => (
              <StackedBarChart
                series={chartSeries}
                format={(v) => f.compact(v)}
                emptyMessage={t('logs.chart.empty')}
                ariaLabel={t('logs.chart.title')}
                onTimeClick={(at) => explore({ from: new Date(at).toISOString(), to: new Date(at + s.bucketSec * 1000).toISOString(), level: MODE_FILTER[mode] })}
              />
            )}
          </QueryView>
        </Panel>
        <Panel title={t('logs.issues.title')}>
          {data ? <AlertList items={issues} okChecks={okIssues} /> : <PanelState status="loading" />}
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel title={t('logs.sources.title')} flush>
          <DataTable data={data?.sources ?? []} columns={sourceCols} getRowId={(s) => s.runtime} emptyMessage={t('logs.sources.empty')} initialSorting={[{ id: 'errors', desc: true }]} />
        </Panel>
        <Panel title={t('logs.levels.title')}>
          <BarList
            items={(data?.levels ?? []).map((l) => ({
              id: l.level,
              label: l.level.toUpperCase(),
              value: l.count,
              display: `${f.compact(l.count)} · ${l.percent === null ? NO_VALUE : f.percent(l.percent)}`,
              tone: l.level === 'error' || l.level === 'fatal' ? 'crit' : l.level === 'warn' ? 'warn' : 'info',
              onClick: () => explore({ level: l.level }),
            }))}
          />
          {data && data.modules.length > 0 && (
            <>
              <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">{t('logs.modules.title')}</h3>
              <BarList
                items={data.modules.slice(0, TOP_LIST_SIZE).map((m) => ({
                  id: m.module,
                  label: <span className="font-mono text-xs">{moduleLabel(m.module)}</span>,
                  value: m.total,
                  display: f.compact(m.total),
                  sub: m.errors > 0 ? <span className="text-crit-fg">{t('logs.modules.errors', { count: f.compact(m.errors) })}</span> : undefined,
                  onClick: () => explore({ module: m.module }),
                }))}
              />
            </>
          )}
        </Panel>
      </PanelGrid>

      <Panel
        title={t('logs.groups.title')}
        flush
        className="mb-4"
        actions={
          <Button size="xs" variant="ghost" onClick={() => go('errors')}>
            {t('logs.groups.viewAll')}
          </Button>
        }
      >
        <ErrorGroupTable rows={data?.topErrors ?? []} onOpen={openError} compact />
      </Panel>

      <PanelGrid>
        <Panel
          title={t('logs.audit.recent')}
          flush
          actions={
            <Button size="xs" variant="ghost" onClick={() => go('audit')}>
              {t('logs.audit.viewAll')}
            </Button>
          }
        >
          <AuditTable rows={data?.recentAudit ?? []} navigate={navigate} compact />
        </Panel>
        <Panel title={t('logs.report.title')} hint={t('logs.report.hint')}>
          <QueryView query={report} isEmpty={(d) => !d.available} emptyMessage={t('logs.report.unavailable')}>
            {(rep) => (
              <>
                <ComparisonTable
                  rows={[
                    ...(['logs', 'errors', 'warnings', 'fatal'] as const).map(
                      (key): ComparisonRow => ({
                        id: key,
                        label: t(`logs.report.${key}`),
                        current: rep.current[key],
                        previous: rep.previous[key],
                        format: (v) => f.compact(v),
                        higherIsWorse: key === 'logs' ? null : true,
                      }),
                    ),
                    { id: 'unique', label: t('logs.report.unique'), current: rep.current.uniqueErrors, previous: rep.previous.uniqueErrors, format: (v) => f.compact(v), higherIsWorse: true },
                    { id: 'peak', label: t('logs.report.peak'), current: rep.current.peakPerMin, previous: rep.previous.peakPerMin, format: (v) => f.compact(v), higherIsWorse: null },
                  ]}
                />
                <KeyValueGrid
                  className="mt-3"
                  columns={1}
                  items={[
                    {
                      label: t('logs.report.topError'),
                      value: r?.current.topError ? (
                        <button type="button" className="text-left text-info-fg hover:underline" onClick={() => openError(r.current.topError!.fingerprint)}>
                          {r.current.topError.label} ({f.compact(r.current.topError.count)})
                        </button>
                      ) : null,
                    },
                    {
                      label: t('logs.report.topSource'),
                      value: rep.current.topErrorSource ? `${t(`rt.name.${rep.current.topErrorSource.runtime}`)} (${f.compact(rep.current.topErrorSource.count)})` : null,
                    },
                  ]}
                />
              </>
            )}
          </QueryView>
        </Panel>
      </PanelGrid>
    </>
  );
}
