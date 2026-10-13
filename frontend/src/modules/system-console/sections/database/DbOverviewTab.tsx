import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE, UNIT } from '@core/lib/format';
import type { Tone } from '@core/theme';
import { Button } from '@core/ui/primitives';
import {
  ActivityFeed,
  AlertList,
  ComparisonTable,
  DataTable,
  KeyValueGrid,
  Panel,
  PanelGrid,
  PanelState,
  StatGrid,
  StatTile,
  UsageBar,
  type ActivityItem,
  type AlertItem,
  type ComparisonRow,
} from '@core/ui/blocks';
import type { DbOverview, DbReport, DbTable } from '../../types/database.types';
import { ALERT_TONE, DB_OVERVIEW_EVENTS, DB_PREVIEW_MAX_HEIGHT_PX, EVENT_TONE, POOL_USAGE_THRESHOLDS } from '../../constants/database';
import { SessionTable } from '../../components/database/SessionTable';
import { DbSectionGate } from '../../components/database/DbSectionGate';
import { DbMetricChart } from './DbMetricChart';
import type { DatabasePage } from './useDatabasePage';
import type { DbActions } from './useDbActions';

const tableCol = createColumnHelper<DbTable>();

/** Tổng quan: chỉ số chính → biểu đồ + vấn đề → query đang chạy + pool / transaction → bảng lớn + báo cáo → sự kiện. */
export function DbOverviewTab({ page, overview, actions }: { page: DatabasePage; overview: UseQueryResult<DbOverview>; actions: DbActions }) {
  const { t } = useLocale();
  const f = useFormat();
  const data = overview.data;
  const k = data?.kpis;
  const loading = !data && !overview.isError;
  /** Chưa có dữ liệu: đang tải, hoặc lỗi kèm nút thử lại (không kẹt ở khung chờ). */
  const pending = (className?: string) =>
    overview.isError ? (
      <PanelState status="error" error={overview.error} onRetry={() => void overview.refetch()} compact className={className} />
    ) : (
      <PanelState status="loading" className={className} />
    );

  /** Tông của KPI theo cảnh báo đang mở (không có cảnh báo → ổn, không có số → chưa rõ). */
  const alertTone = (value: unknown, ...rules: string[]): Tone | undefined => {
    if (!data) return undefined;
    const hits = data.alerts.filter((a) => rules.includes(a.rule));
    if (hits.some((a) => a.severity === 'critical')) return 'crit';
    if (hits.length) return 'warn';
    return value === null || value === undefined ? undefined : 'ok';
  };

  const issues: AlertItem[] = (data?.alerts ?? []).map((a) => ({
    id: a.id,
    tone: ALERT_TONE[a.severity],
    title: a.title,
    detail: a.message,
    since: a.since,
    onInspect: () => page.goLegacy(a.tab),
  }));
  const okChecks: string[] = [];
  if (data) {
    const rules = new Set(data.alerts.map((a) => a.rule));
    if (data.kpis.deadlocks24h === 0) okChecks.push(t('db.alerts.noDeadlocks'));
    if (data.kpis.lockWaits === 0 && !rules.has('LOCK_WAITS')) okChecks.push(t('db.alerts.noLocks'));
    if (data.health.status === 'healthy' || data.health.status === 'degraded') okChecks.push(t('db.alerts.connected'));
  }

  const events: ActivityItem[] = (data?.events ?? []).slice(0, DB_OVERVIEW_EVENTS).map((e) => ({
    id: e.id,
    at: e.at,
    tone: EVENT_TONE[e.severity],
    title: t(`db.event.${e.type}`),
    detail: e.message,
    onClick: e.tab ? () => page.goLegacy(e.tab) : undefined,
  }));

  const tableColumns = useMemo(
    () => [
      tableCol.accessor('name', { header: t('db.table.name'), meta: { mono: true, truncate: true } }),
      tableCol.accessor('rows', { header: t('db.table.rows'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
      tableCol.accessor('totalBytes', { header: t('db.table.total'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
      tableCol.accessor('growthPercent', { header: t('db.table.growth'), cell: (c) => f.delta(c.getValue(), 1, UNIT.percent) ?? NO_VALUE, meta: { align: 'right', mono: true, width: '90px' } }),
    ],
    [t, f],
  );

  const reportRows: ComparisonRow[] = data
    ? (
        [
          ['queries', (v: number | null) => f.compact(v), null],
          ['avgMs', (v: number | null) => f.duration(v), true],
          ['failedQueries', (v: number | null) => f.number(v), true],
          ['peakConnections', (v: number | null) => f.number(v), null],
          ['deadlocks', (v: number | null) => f.number(v), true],
          ['growthBytes', (v: number | null) => f.bytes(v), null],
        ] as [keyof DbReport, (v: number | null) => string, boolean | null][]
      ).map(([key, format, higherIsWorse]) => ({
        id: key,
        label: t(`db.report.${key}`),
        current: data.report.today[key],
        previous: data.report.yesterday[key],
        format: key === 'growthBytes' ? (v: number | null) => (v === null ? NO_VALUE : `${v > 0 ? '+' : ''}${format(v)}`) : format,
        higherIsWorse,
        compare: key !== 'growthBytes',
      }))
    : [];

  const txTone = alertTone(k?.activeTransactions, 'LONG_TRANSACTION', 'LOCK_WAITS');
  const pool = data?.pool;
  const tx = data?.transactions;
  const longTx = data && tx?.longestSec !== null && tx?.longestSec !== undefined && tx.longestSec >= data.settings.longTransactionSec;

  return (
    <>
      <StatGrid columns={6}>
        <StatTile
          label={t('db.kpi.connections')}
          value={k?.connections.used === null || k?.connections.used === undefined ? NO_VALUE : `${Math.round(k.connections.used)} / ${k.connections.limit}`}
          sub={k?.sessions === null || k?.sessions === undefined ? undefined : t('db.kpi.sessionsShort', { count: k.sessions })}
          hint={t('db.kpi.poolSub')}
          tone={alertTone(k?.connections.used, 'POOL_PRESSURE', 'POOL_WAITING')}
          loading={loading}
          onClick={() => page.goView('queries', 'connections')}
        />
        <StatTile label={t('db.kpi.avgMs')} value={f.duration(k?.avgMs)} hint={t('db.kpi.avgSub')} tone={alertTone(k?.avgMs, 'QUERY_LATENCY')} loading={loading} onClick={() => page.goTab('queries')} />
        <StatTile label={t('db.kpi.qps')} value={f.rate(k?.queriesPerSec)} hint={data ? t('db.kpi.fromApp', { range: t(`ui.time.ranges.${data.range}`) }) : undefined} loading={loading} />
        <StatTile
          label={t('db.kpi.errorRate')}
          value={f.percent(k?.errorRatePercent, 2)}
          sub={k?.failedQueries === null || k?.failedQueries === undefined ? undefined : t('db.kpi.failedShort', { count: f.compact(k.failedQueries) })}
          tone={alertTone(k?.errorRatePercent, 'ERROR_RATE')}
          loading={loading}
          onClick={() => page.goTab('activity')}
        />
        <StatTile
          label={t('db.kpi.transactions')}
          value={k?.activeTransactions === null || k?.activeTransactions === undefined ? NO_VALUE : f.number(k.activeTransactions)}
          sub={k ? t('db.kpi.txShort', { locks: k.lockWaits === null ? NO_VALUE : f.number(k.lockWaits), deadlocks: f.number(k.deadlocks24h) }) : undefined}
          hint={t('db.kpi.txHint')}
          tone={txTone === 'ok' && (k?.deadlocks24h ?? 0) > 0 ? 'warn' : txTone}
          loading={loading}
          onClick={() => page.goView('queries', 'transactions')}
        />
        <StatTile label={t('db.kpi.size')} value={f.bytes(k?.sizeBytes)} hint={t('db.kpi.sizeSub')} tone={alertTone(k?.sizeBytes, 'STORAGE')} loading={loading} onClick={() => page.goTab('tables')} />
      </StatGrid>

      <PanelGrid layout="2-1">
        <DbMetricChart range={page.range} />
        <Panel title={t('db.alerts.title')}>{data ? <AlertList items={issues} okChecks={okChecks} /> : pending()}</Panel>
      </PanelGrid>

      <PanelGrid layout="2-1">
        <Panel
          title={t('db.live.title')}
          hint={data ? t('db.live.hint', { ms: data.settings.slowQueryMs }) : undefined}
          flush
          actions={
            <Button size="xs" variant="ghost" onClick={() => page.goTab('queries')}>
              {t('db.live.viewAll')}
            </Button>
          }
        >
          {data ? (
            <DbSectionGate section={data.liveQueries} driver={data.driver}>
              {(list) => (
                <SessionTable
                  sessions={list}
                  slowMs={data.settings.slowQueryMs}
                  actionsEnabled={data.settings.actionsEnabled}
                  canCancel={data.capabilities.includes('cancel')}
                  canTerminate={false}
                  onOpen={(s) => page.openSession(s.id)}
                  onCancel={actions.requestCancel}
                  emptyMessage={t('db.live.empty')}
                  maxHeight={DB_PREVIEW_MAX_HEIGHT_PX}
                />
              )}
            </DbSectionGate>
          ) : (
            pending('p-3')
          )}
        </Panel>
        <Panel title={t('db.pool.title')} hint={data ? t('db.pool.note', { runtimes: data.runtimes.length }) : undefined}>
          {pool && data ? (
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 flex items-baseline gap-1.5">
                  <span className="font-mono text-xl font-semibold tabular-nums text-fg">{pool.used === null ? NO_VALUE : Math.round(pool.used)}</span>
                  <span className="font-mono text-sm text-muted">/ {pool.limit}</span>
                </div>
                <UsageBar percent={pool.percent} thresholds={POOL_USAGE_THRESHOLDS} />
              </div>
              <KeyValueGrid
                items={[
                  { label: t('db.pool.idle'), value: pool.idle === null ? null : f.number(pool.idle), mono: true },
                  { label: t('db.pool.waiting'), value: f.number(pool.waiting), mono: true },
                  { label: t('db.pool.peakToday'), value: f.number(pool.peakToday), mono: true },
                  { label: t('db.pool.sessions'), value: f.number(data.kpis.sessions), mono: true },
                ]}
              />
              <div className="border-t border-border pt-3">
                <KeyValueGrid
                  items={[
                    { label: t('db.tx.active'), value: f.number(tx?.active), mono: true },
                    {
                      label: t('db.tx.longest'),
                      value: tx?.longestSec === null || tx?.longestSec === undefined ? null : <span className={longTx ? 'text-warn-fg' : undefined}>{f.duration(tx.longestSec * 1000)}</span>,
                      mono: true,
                    },
                    { label: t('db.tx.lockWaits'), value: f.number(data.kpis.lockWaits), mono: true },
                    { label: t('db.kpi.deadlocks'), value: f.number(data.kpis.deadlocks24h), mono: true },
                  ]}
                />
              </div>
            </div>
          ) : (
            pending()
          )}
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel
          title={t('db.tables.largest')}
          flush
          actions={
            <Button size="xs" variant="ghost" onClick={() => page.goTab('tables')}>
              {t('db.tables.viewAll')}
            </Button>
          }
        >
          {data ? (
            <DbSectionGate section={data.largestTables} driver={data.driver}>
              {(list) => <DataTable data={list} columns={tableColumns} getRowId={(r) => r.name} onRowClick={(r) => page.openTable(r.name)} emptyMessage={t('db.tables.empty')} />}
            </DbSectionGate>
          ) : (
            pending('p-3')
          )}
        </Panel>
        <Panel title={t('db.report.title')} hint={t('db.report.hint')}>
          {data ? <ComparisonTable rows={reportRows} /> : pending()}
        </Panel>
      </PanelGrid>

      <Panel
        title={t('db.events.title')}
        actions={
          <Button size="xs" variant="ghost" onClick={() => page.goTab('activity')}>
            {t('db.events.viewAll')}
          </Button>
        }
      >
        {data ? <ActivityFeed items={events} emptyMessage={t('db.events.empty')} /> : pending()}
      </Panel>
    </>
  );
}
