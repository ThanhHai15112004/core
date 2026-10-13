import { useState } from 'react';
import { ArrowLeft, Briefcase, Database, FileSearch } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import { KeyValueGrid, Panel, PanelGrid, QueryView, SearchInput, StatusBanner } from '@core/ui/blocks';
import { BarList, TimeSeriesChart } from '@core/ui/charts';
import { logsApi } from '../../services/logs.api';
import { DEPENDENCY_SECTION } from '../../constants/logs';
import { ErrorGroupTable, TrendBadge } from '../../components/logs/ErrorGroupTable';
import { LogTable } from '../../components/logs/LogTable';
import { logsKeys } from './logs-keys';
import type { LogsPage } from './useLogsPage';

const CALLOUT_SIZE = 3;
const AFFECTED_SIZE = 8;

/** Nhóm lỗi: gom theo fingerprint (loại lỗi + module + message chuẩn hoá + vị trí stack), không theo chuỗi thô. */
export function LogsErrorsTab({ page }: { page: LogsPage }) {
  const { t } = useLocale();
  const f = useFormat();
  const [q, setQ] = useState('');
  const query = useLiveQuery(logsKeys.errors(page.range, q), () => logsApi.errors(page.range, q || undefined));
  const items = query.data?.items ?? [];
  const spiking = items.filter((g) => g.spiking).slice(0, CALLOUT_SIZE);
  const fresh = items.filter((g) => g.isNew).slice(0, CALLOUT_SIZE);

  return (
    <>
      {(spiking.length > 0 || fresh.length > 0) && (
        <PanelGrid>
          {spiking.length > 0 && (
            <StatusBanner
              tone="crit"
              className="mb-0"
              title={t('logs.groups.spikeTitle')}
              reasons={spiking.map((g) => ({ id: g.fingerprint, text: `${g.errorType ?? g.template}${g.changePercent !== null ? ` +${g.changePercent}%` : ''}`, onClick: () => page.openError(g.fingerprint) }))}
            />
          )}
          {fresh.length > 0 && (
            <StatusBanner
              tone="warn"
              className="mb-0"
              title={t('logs.groups.newTitle')}
              reasons={fresh.map((g) => ({ id: g.fingerprint, text: `${g.errorType ?? g.template} · ${t('logs.groups.occurrences', { count: f.compact(g.total) })}`, onClick: () => page.openError(g.fingerprint) }))}
            />
          )}
        </PanelGrid>
      )}
      <Panel title={t('logs.groups.title')} hint={t('logs.groups.note')} flush actions={<SearchInput value={q} onChange={setQ} placeholder={t('logs.groups.search')} className="w-72" />}>
        <QueryView query={query} compact>
          {(d) => (
            <>
              <ErrorGroupTable rows={d.items} onOpen={page.openError} />
              {d.otherCount > 0 && <p className="border-t border-border px-3 py-2 text-xs text-faint">{t('logs.groups.other', { count: d.otherCount })}</p>}
            </>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

/** Chi tiết một nhóm lỗi: số lần, lần đầu / cuối, biểu đồ, nơi bị ảnh hưởng, mẫu log, tương quan khởi động. */
export function ErrorGroupDetail({ page, fingerprint }: { page: LogsPage; fingerprint: string }) {
  const { t, formatTime, formatRelative } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(logsKeys.errorGroup(fingerprint, page.range), () => logsApi.errorGroup(fingerprint, page.range), { keepPrevious: false });

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => page.go('errors')}>
        <ArrowLeft />
        {t('logs.groups.back')}
      </Button>
      <QueryView query={query}>
        {(d) => (
          <>
            <Panel
              className="mb-4"
              title={
                <span className="flex items-center gap-2">
                  {d.errorType ?? t('logs.groups.untyped')}
                  <TrendBadge g={d} />
                </span>
              }
              actions={
                <>
                  <Button size="sm" variant="primary" onClick={() => page.explore({ fingerprint: d.fingerprint, window: '7d' })}>
                    <FileSearch />
                    {t('logs.groups.viewLogs')}
                  </Button>
                  {d.jobTypes.length > 0 && (
                    <Button size="sm" onClick={() => page.navigate(`jobs/explorer?status=failed${d.errorType ? `&errorType=${encodeURIComponent(d.errorType)}` : ''}`)}>
                      <Briefcase />
                      {t('logs.groups.viewJobs')}
                    </Button>
                  )}
                  {d.dependency && (
                    <Button size="sm" onClick={() => page.navigate(DEPENDENCY_SECTION[d.dependency!]!)}>
                      <Database />
                      {t('logs.detail.openDependency', { name: t(`logs.dependency.${d.dependency}`) })}
                    </Button>
                  )}
                </>
              }
            >
              <p className="mb-1 break-words font-mono text-sm text-fg">{d.template}</p>
              {(d.module || d.frame) && (
                <p className="mb-3 font-mono text-xs text-muted">
                  {d.module}
                  {d.frame ? ` · ${d.frame}` : ''}
                </p>
              )}
              <KeyValueGrid
                columns={3}
                items={[
                  { label: t('logs.groups.occurrencesRange'), value: f.compact(d.count), mono: true },
                  { label: t('logs.groups.totalTracked'), value: f.compact(d.total), mono: true },
                  { label: t('logs.groups.firstSeenLabel'), value: d.firstSeen ? `${formatTime(d.firstSeen, true)} (${formatRelative(d.firstSeen)})` : null },
                  { label: t('logs.groups.lastSeenLabel'), value: d.lastSeen ? formatRelative(d.lastSeen) : null },
                  {
                    label: t('logs.groups.rate'),
                    value: (
                      <span className="flex flex-wrap items-center gap-2">
                        {t('logs.groups.rateValue', { current: d.currentPerMin ?? NO_VALUE, baseline: d.baselinePerMin ?? NO_VALUE })}
                        {d.spiking && <Badge tone="crit">{t('logs.trend.spike')}</Badge>}
                      </span>
                    ),
                  },
                  ...(d.nearestStart
                    ? [
                        {
                          label: t('logs.groups.correlation'),
                          value: t('logs.groups.afterStart', { minutes: d.nearestStart.minutesBefore, runtime: t(`rt.name.${d.nearestStart.runtime}`) }),
                          hint: t('logs.groups.correlationNote'),
                        },
                      ]
                    : []),
                ]}
              />
            </Panel>

            <Panel title={t('logs.groups.overTime')} className="mb-4">
              <TimeSeriesChart
                kind="bar"
                height="sm"
                series={[{ id: 'n', label: t('logs.groups.count'), color: 'crit', points: d.series.map((p) => ({ t: Date.parse(p.t), v: p.count })) }]}
                format={(v) => f.compact(v)}
                emptyMessage={t('logs.chart.empty')}
                ariaLabel={t('logs.groups.overTime')}
              />
            </Panel>

            <PanelGrid layout={3}>
              {(['runtimes', 'jobTypes', 'routes'] as const).map((key) => (
                <Panel key={key} title={t(`logs.groups.affected_${key}`)}>
                  <BarList
                    items={d.affected[key].slice(0, AFFECTED_SIZE).map((x) => ({
                      id: x.name,
                      label: <span className="font-mono text-xs">{key === 'runtimes' ? t(`rt.name.${x.name}`) : x.name}</span>,
                      value: x.count,
                      display: f.compact(x.count),
                      tone: 'crit',
                    }))}
                  />
                  {d.affected[key].length === 0 && <p className="text-sm text-faint">{NO_VALUE}</p>}
                </Panel>
              ))}
            </PanelGrid>

            <Panel title={t('logs.groups.samples')} description={t('logs.groups.samplesHint')} flush>
              <LogTable rows={d.samples} onOpen={page.openLog} activeId={page.logId} emptyMessage={t('logs.groups.noSamples')} />
            </Panel>
          </>
        )}
      </QueryView>
    </>
  );
}
