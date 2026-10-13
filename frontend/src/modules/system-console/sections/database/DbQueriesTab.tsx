import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { FileText } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import {
  DataTable,
  KeyValueGrid,
  Panel,
  PanelGrid,
  PanelState,
  QueryView,
  RelativeTime,
  StatGrid,
  StatTile,
  StatusDot,
  UsageBar, AvailableView } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { DbOverview, DbQueryStat, DbSession, DbTransaction } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import {
  DB_QUERY_VIEWS,
  DB_TABLE_MAX_HEIGHT_PX,
  LIVE_STATE_FILTERS,
  POOL_USAGE_THRESHOLDS,
  SLOW_THRESHOLDS,
  type LiveStateFilter,
} from '../../constants/database';
import { SessionTable } from '../../components/database/SessionTable';
import { BlockingTree } from '../../components/database/BlockingTree';
import { runtimeLabel } from '../../components/database/db-labels';
import { DbCapabilityGate, DbViewSwitch } from './DbViewSwitch';
import { dbKeys } from './database-keys';
import type { DatabasePage } from './useDatabasePage';
import type { DbActions } from './useDbActions';

interface TabProps {
  page: DatabasePage;
  overview: DbOverview | undefined;
  actions: DbActions;
}

/** Queries & Sessions: query đang chạy + thống kê theo dạng câu · kết nối / session · transaction & lock. */
export function DbQueriesTab({ page, overview, actions }: TabProps) {
  return (
    <>
      <DbViewSwitch views={DB_QUERY_VIEWS} value={page.queryView} onChange={(v) => page.goView('queries', v)} />
      {page.queryView === 'connections' ? (
        <DbCapabilityGate view="connections" overview={overview}>
          <ConnectionsView page={page} overview={overview} actions={actions} />
        </DbCapabilityGate>
      ) : page.queryView === 'transactions' ? (
        <DbCapabilityGate view="transactions" overview={overview}>
          <TransactionsView page={page} overview={overview} />
        </DbCapabilityGate>
      ) : (
        <QueriesView page={page} overview={overview} actions={actions} />
      )}
    </>
  );
}

const matchesState = (s: DbSession, filter: LiveStateFilter, slowMs: number) =>
  filter === 'running' ? s.state === 'active' : filter === 'slow' ? (s.queryMs ?? 0) >= slowMs : filter === 'blocked' ? s.state === 'blocked' : true;

const statCol = createColumnHelper<DbQueryStat>();

function QueriesView({ page, overview, actions }: TabProps) {
  const { t } = useLocale();
  const f = useFormat();
  const live = useLiveQuery(dbKeys.live(), () => databaseApi.liveQueries());
  const stats = useLiveQuery(dbKeys.stats(page.range, page.minMs), () => databaseApi.queryStats(page.range, page.minMs), { tier: 'slow' });
  const driver = overview?.driver;
  const canCancel = overview?.capabilities.includes('cancel') ?? false;

  const statColumns = useMemo(
    () => [
      statCol.accessor('sql', {
        header: t('db.stats.query'),
        enableSorting: false,
        cell: (c) => (
          <span className="flex min-w-0 items-center gap-1.5">
            {c.row.original.slow && (
              <Badge tone="warn" size="xs">
                {t('db.query.slow')}
              </Badge>
            )}
            <span className="truncate font-mono text-xs text-fg-2">{c.getValue()}</span>
          </span>
        ),
        meta: { truncate: true },
      }),
      statCol.accessor((q) => (q.timingReliable ? q.avgMs : null), {
        id: 'avgMs',
        header: t('db.query.avg'),
        cell: (c) => (c.row.original.timingReliable ? f.duration(c.getValue()) : <span className="font-sans text-faint">{t('db.query.unreliableShort')}</span>),
        meta: { align: 'right', mono: true, width: '100px' },
      }),
      statCol.accessor((q) => (q.timingReliable ? q.maxMs : null), { id: 'maxMs', header: t('db.query.max'), cell: (c) => f.duration(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
      statCol.accessor('calls', { header: t('db.query.calls'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
      statCol.accessor('noIndexUsed', { header: t('db.query.noIndex'), cell: (c) => (c.getValue() ? f.compact(c.getValue()) : NO_VALUE), meta: { align: 'right', mono: true, width: '110px' } }),
      statCol.accessor((q) => (q.lastSeen ? Date.parse(q.lastSeen) : null), {
        id: 'lastSeen',
        header: t('db.query.lastSeen'),
        cell: (c) => <RelativeTime value={c.row.original.lastSeen} className="text-muted" />,
        meta: { align: 'right', width: '110px' },
      }),
    ],
    [t, f],
  );

  return (
    <>
      <Panel
        className="mb-4"
        title={t('db.live.title')}
        hint={live.data ? t('db.live.hint', { ms: live.data.slowQueryMs }) : undefined}
        flush
        actions={
          <ToggleGroup type="single" value={page.stateFilter} onValueChange={(v) => v && page.setFilter({ state: v === 'all' ? undefined : v })} aria-label={t('db.live.filter')}>
            {LIVE_STATE_FILTERS.map((s) => (
              <ToggleGroupItem key={s} value={s}>
                {t(`db.live.state.${s}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      >
        <QueryView query={live}>
          {(d) => (
            <AvailableView source={d.sessions} product={driver} onRetry={() => void live.refetch()}>
              {(list) => (
                <SessionTable
                  sessions={list.filter((s) => matchesState(s, page.stateFilter, d.slowQueryMs))}
                  slowMs={d.slowQueryMs}
                  actionsEnabled={d.actionsEnabled}
                  canCancel={canCancel}
                  canTerminate={false}
                  onOpen={(s) => page.openSession(s.id)}
                  onCancel={actions.requestCancel}
                  activeId={page.sessionId}
                  emptyMessage={t('db.live.empty')}
                  maxHeight={DB_TABLE_MAX_HEIGHT_PX}
                />
              )}
            </AvailableView>
          )}
        </QueryView>
      </Panel>

      <Panel
        title={t('db.stats.title')}
        hint={t('db.stats.note')}
        flush
        actions={
          <ToggleGroup type="single" value={String(page.minMs)} onValueChange={(v) => v && page.setFilter({ minMs: Number(v) || undefined })} aria-label={t('db.stats.threshold')}>
            {SLOW_THRESHOLDS.map((ms) => (
              <ToggleGroupItem key={ms} value={String(ms)}>
                {ms === 0 ? t('db.stats.all') : `> ${f.duration(ms)}`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      >
        <QueryView query={stats}>
          {(d) => (
            <AvailableView source={d.stats} product={driver} onRetry={() => void stats.refetch()}>
              {(list) => (
                <DataTable
                  data={list}
                  columns={statColumns}
                  getRowId={(q) => q.id}
                  onRowClick={(q) => page.openQuery(q.id)}
                  activeRowId={page.digestId}
                  rowTone={(q) => (q.slow ? 'warn' : undefined)}
                  initialSorting={[{ id: 'avgMs', desc: true }]}
                  maxHeight={DB_TABLE_MAX_HEIGHT_PX}
                  emptyMessage={page.minMs > 0 ? t('db.stats.noSlow', { ms: f.duration(page.minMs), range: t(`ui.time.ranges.${page.range}`) }) : t('db.stats.empty')}
                />
              )}
            </AvailableView>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

function ConnectionsView({ page, overview, actions }: TabProps) {
  const { t } = useLocale();
  const f = useFormat();
  const q = useLiveQuery(dbKeys.connections(), () => databaseApi.connections());
  const d = q.data;
  const filter = page.runtimeFilter;
  const total = d?.byRuntime.reduce((a, r) => a + r.count, 0) ?? 0;

  return (
    <>
      <PanelGrid>
        <Panel title={t('db.pool.title')} hint={t('db.pool.scopeNote')}>
          <QueryView query={q} compact>
            {(data) => (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-1.5 flex items-baseline gap-1.5">
                    <span className="font-mono text-xl font-semibold tabular-nums text-fg">{data.pool.used === null ? NO_VALUE : Math.round(data.pool.used)}</span>
                    <span className="font-mono text-sm text-muted">/ {data.pool.limit}</span>
                  </div>
                  <UsageBar percent={data.pool.percent} thresholds={POOL_USAGE_THRESHOLDS} />
                </div>
                <KeyValueGrid
                  columns={4}
                  items={[
                    { label: t('db.pool.idle'), value: data.pool.idle === null ? null : f.number(data.pool.idle), mono: true },
                    { label: t('db.pool.waiting'), value: f.number(data.pool.waiting), mono: true },
                    { label: t('db.pool.peakToday'), value: f.number(data.pool.peakToday), mono: true },
                    { label: t('db.pool.serverMax'), value: f.number(data.maxConnections), mono: true },
                  ]}
                />
              </div>
            )}
          </QueryView>
        </Panel>
        <Panel
          title={t('db.conn.byRuntime')}
          actions={
            filter ? (
              <Button size="xs" variant="ghost" onClick={() => page.setFilter({ runtime: undefined })}>
                {t('ui.action.clear')}
              </Button>
            ) : undefined
          }
        >
          <QueryView query={q} compact isEmpty={(data) => data.byRuntime.length === 0} emptyMessage={t('db.conn.empty')}>
            {(data) => (
              <BarList
                items={data.byRuntime.map((r) => ({
                  id: r.runtime,
                  label: (
                    <span className={filter === r.runtime ? 'font-semibold text-fg' : undefined}>
                      {runtimeLabel(r.runtime, t)}
                    </span>
                  ),
                  value: r.count,
                  display: f.number(r.count),
                  sub: t('db.conn.active', { count: r.active }),
                  tone: filter === r.runtime ? 'info' : undefined,
                  onClick: () => page.setFilter({ runtime: filter === r.runtime ? undefined : r.runtime }),
                }))}
              />
            )}
          </QueryView>
          {total > 0 && <div className="mt-2 text-right font-mono text-xs text-muted">{t('db.conn.total', { count: total })}</div>}
        </Panel>
      </PanelGrid>

      <Panel title={t('db.conn.title')} flush actions={filter ? <Badge tone="info">{runtimeLabel(filter, t)}</Badge> : undefined}>
        <QueryView query={q}>
          {(data) => (
            <AvailableView source={data.sessions} product={overview?.driver} onRetry={() => void q.refetch()}>
              {(list) => (
                <SessionTable
                  sessions={list.filter((s) => !filter || (s.runtime ?? 'other') === filter)}
                  slowMs={overview?.settings.slowQueryMs ?? null}
                  actionsEnabled={data.actionsEnabled}
                  canCancel={overview?.capabilities.includes('cancel') ?? false}
                  canTerminate={overview?.capabilities.includes('terminate') ?? false}
                  onOpen={(s) => page.openSession(s.id)}
                  onCancel={actions.requestCancel}
                  onTerminate={actions.requestTerminate}
                  activeId={page.sessionId}
                  emptyMessage={t('db.conn.empty')}
                  maxHeight={DB_TABLE_MAX_HEIGHT_PX}
                />
              )}
            </AvailableView>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

const txCol = createColumnHelper<DbTransaction>();

function TransactionsView({ page, overview }: Omit<TabProps, 'actions'>) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const q = useLiveQuery(dbKeys.transactions(), () => databaseApi.transactions());
  const d = q.data;
  const longSec = d?.longTransactionSec ?? overview?.settings.longTransactionSec ?? null;
  const isLong = (sec: number | null) => longSec !== null && sec !== null && sec >= longSec;

  const columns = useMemo(
    () => [
      txCol.accessor('sessionId', { header: t('db.session.id'), cell: (c) => `#${c.getValue() ?? NO_VALUE}`, meta: { mono: true, width: '110px' } }),
      txCol.accessor((x) => runtimeLabel(x.runtime, t), { id: 'source', header: t('db.session.source'), meta: { width: '130px', truncate: true } }),
      txCol.accessor('ageSec', {
        header: t('db.tx.age'),
        cell: (c) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {isLong(c.getValue()) && (
              <Badge tone="warn" size="xs" className="font-sans">
                {t('db.tx.long')}
              </Badge>
            )}
            {f.duration(c.getValue() * 1000)}
          </span>
        ),
        meta: { align: 'right', mono: true, width: '130px' },
      }),
      txCol.accessor('locksHeld', { header: t('db.tx.locks'), cell: (c) => f.number(c.getValue()), meta: { align: 'right', mono: true, width: '80px' } }),
      txCol.accessor('isolation', { header: t('db.tx.isolation'), cell: (c) => c.getValue() ?? NO_VALUE, meta: { width: '170px', truncate: true } }),
      txCol.accessor('query', {
        header: t('db.session.query'),
        enableSorting: false,
        cell: (c) => <span className={c.getValue() ? 'font-mono text-xs text-fg-2' : 'text-xs text-faint'}>{c.getValue() ?? t('db.tx.idle')}</span>,
        meta: { truncate: true },
      }),
    ],
    [t, f, longSec], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const openLogs = (correlationId: string) => page.navigate(`logs/explorer?correlationId=${encodeURIComponent(correlationId)}`);

  return (
    <>
      <StatGrid columns={3}>
        <StatTile label={t('db.tx.active')} value={f.number(d?.stats.active)} loading={!d && !q.isError} />
        <StatTile
          label={t('db.tx.longest')}
          value={d?.stats.longestSec === null || d?.stats.longestSec === undefined ? NO_VALUE : f.duration(d.stats.longestSec * 1000)}
          tone={d ? (isLong(d.stats.longestSec) ? 'warn' : undefined) : undefined}
          loading={!d && !q.isError}
        />
        <StatTile
          label={t('db.tx.deadlocksToday')}
          value={d ? f.number(d.deadlocks.today) : NO_VALUE}
          sub={d ? t('db.deadlocks.last24h', { count: f.number(d.deadlocks.last24h) }) : undefined}
          tone={d ? (d.deadlocks.today > 0 ? 'warn' : 'ok') : undefined}
          loading={!d && !q.isError}
        />
      </StatGrid>

      <Panel title={t('db.tx.list')} hint={longSec !== null ? t('db.tx.hint', { sec: longSec }) : undefined} flush className="mb-4">
        <QueryView query={q}>
          {(data) => (
            <AvailableView source={data.transactions} product={overview?.driver} onRetry={() => void q.refetch()}>
              {(list) => (
                <DataTable
                  data={list}
                  columns={columns}
                  getRowId={(x) => x.id}
                  onRowClick={(x) => x.sessionId && page.openSession(x.sessionId)}
                  activeRowId={page.sessionId ? list.find((x) => x.sessionId === page.sessionId)?.id : undefined}
                  rowTone={(x) => (isLong(x.ageSec) ? 'warn' : undefined)}
                  initialSorting={[{ id: 'ageSec', desc: true }]}
                  emptyMessage={t('db.tx.none')}
                  maxHeight={DB_TABLE_MAX_HEIGHT_PX}
                />
              )}
            </AvailableView>
          )}
        </QueryView>
      </Panel>

      <PanelGrid>
        <Panel title={t('db.locks.title')}>
          <QueryView query={q} compact>
            {(data) => (
              <AvailableView source={data.lockWaits} product={overview?.driver}>
                {(waits) =>
                  waits.length === 0 ? (
                    <PanelState status="empty" compact message={t('db.locks.none')} />
                  ) : (
                    <BlockingTree nodes={data.blockingChains} onOpen={(id) => page.openSession(id)} />
                  )
                }
              </AvailableView>
            )}
          </QueryView>
        </Panel>
        <Panel
          title={t('db.deadlocks.title')}
          hint={t('db.deadlocks.note')}
        >
          <QueryView query={q} compact isEmpty={(data) => data.deadlocks.recent.length === 0} emptyMessage={t('db.deadlocks.none')}>
            {(data) => (
              <ul className="flex flex-col divide-y divide-border">
                {data.deadlocks.recent.map((dl) => (
                  <li key={`${dl.at}-${dl.sql}`} className="flex items-start gap-2.5 py-2">
                    <StatusDot tone="warn" className="mt-1.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-mono text-xs text-fg">{formatTime(dl.at, true)}</span>
                        <span className="text-muted">{runtimeLabel(dl.runtime, t)}</span>
                        <span className="text-xs text-faint">{t('db.deadlocks.resolved')}</span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-xs text-fg-2" title={dl.sql}>
                        {dl.sql}
                      </div>
                    </div>
                    {dl.correlationId && (
                      <Button size="xs" variant="ghost" onClick={() => openLogs(dl.correlationId!)}>
                        <FileText />
                        {t('db.query.openLogs')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
        </Panel>
      </PanelGrid>
    </>
  );
}
