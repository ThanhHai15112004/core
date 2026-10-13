import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Play } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { formatSignedBytes, NO_VALUE, UNIT } from '@core/lib/format';
import { Badge, Button, Hint } from '@core/ui/primitives';
import { DataTable, KeyValueGrid, Panel, PanelGrid, QueryView, RelativeTime, StatGrid, StatTile, StatusBanner, UsageBar } from '@core/ui/blocks';
import { MetricChart, type TimeSeries } from '@core/ui/charts';
import type { DbMigrations, DbOverview, DbTable } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { DB_TABLE_MAX_HEIGHT_PX, DB_TABLE_VIEWS, STORAGE_USAGE_THRESHOLDS } from '../../constants/database';
import { DbSectionGate } from '../../components/database/DbSectionGate';
import { dateTime } from '../../components/database/db-labels';
import { DbCapabilityGate, DbViewSwitch } from './DbViewSwitch';
import { dbKeys } from './database-keys';
import type { DatabasePage } from './useDatabasePage';
import type { DbActions } from './useDbActions';

interface TabProps {
  page: DatabasePage;
  overview: DbOverview | undefined;
  actions: DbActions;
}

/** Tables: dung lượng + tăng trưởng + danh sách bảng · migration (đã chạy / đang chờ, chạy từ Console). */
export function DbTablesTab({ page, overview, actions }: TabProps) {
  return (
    <>
      <DbViewSwitch views={DB_TABLE_VIEWS} value={page.tableView} onChange={(v) => page.goView('tables', v)} />
      {page.tableView === 'migrations' ? (
        <MigrationsView actions={actions} />
      ) : (
        <DbCapabilityGate view="tables" overview={overview}>
          <TablesView page={page} overview={overview} />
        </DbCapabilityGate>
      )}
    </>
  );
}

const col = createColumnHelper<DbTable>();
/** Null xếp cuối khi sort giảm dần. */
const num = (v: number | null | undefined) => v ?? undefined;

function TablesView({ page, overview }: Omit<TabProps, 'actions'>) {
  const { t } = useLocale();
  const f = useFormat();
  const tables = useLiveQuery(dbKeys.tables(), () => databaseApi.tables(), { tier: 'slow' });
  const storage = useLiveQuery(dbKeys.storage(), () => databaseApi.storage(), { tier: 'slow' });
  const st = storage.data;

  const columns = useMemo(
    () => [
      col.accessor('name', { header: t('db.table.name'), meta: { mono: true, truncate: true } }),
      col.accessor((r) => num(r.rows), { id: 'rows', header: t('db.table.rows'), cell: (c) => f.compact(c.row.original.rows), sortUndefined: 'last', meta: { align: 'right', mono: true, width: '100px' } }),
      col.accessor((r) => num(r.dataBytes), { id: 'dataBytes', header: t('db.table.data'), cell: (c) => f.bytes(c.row.original.dataBytes), sortUndefined: 'last', meta: { align: 'right', mono: true, width: '100px' } }),
      col.accessor((r) => num(r.indexBytes), { id: 'indexBytes', header: t('db.table.indexes'), cell: (c) => f.bytes(c.row.original.indexBytes), sortUndefined: 'last', meta: { align: 'right', mono: true, width: '100px' } }),
      col.accessor((r) => num(r.totalBytes), { id: 'totalBytes', header: t('db.table.total'), cell: (c) => f.bytes(c.row.original.totalBytes), sortUndefined: 'last', meta: { align: 'right', mono: true, width: '100px' } }),
      col.accessor((r) => num(r.readsPerSec), { id: 'readsPerSec', header: t('db.table.readsPerSec'), cell: (c) => f.rate(c.row.original.readsPerSec), sortUndefined: 'last', meta: { align: 'right', mono: true, width: '100px' } }),
      col.accessor((r) => num(r.writesPerSec), { id: 'writesPerSec', header: t('db.table.writesPerSec'), cell: (c) => f.rate(c.row.original.writesPerSec), sortUndefined: 'last', meta: { align: 'right', mono: true, width: '100px' } }),
      col.accessor((r) => num(r.growthPercent), {
        id: 'growthPercent',
        header: t('db.table.growth'),
        cell: (c) => f.delta(c.row.original.growthPercent, 1, UNIT.percent) ?? NO_VALUE,
        sortUndefined: 'last',
        meta: { align: 'right', mono: true, width: '100px' },
      }),
    ],
    [t, f],
  );

  const growth: TimeSeries[] | undefined = st ? [{ id: 'size', label: t('db.storage.total'), color: 'series-1', area: true, points: st.history.map((p) => ({ t: p.t, v: p.value })) }] : undefined;

  return (
    <>
      <PanelGrid layout="1-2">
        <Panel title={t('db.storage.title')} hint={t('db.storage.hint')}>
          <QueryView query={storage} compact>
            {(data) => (
              <DbSectionGate section={data.storage} driver={overview?.driver}>
                {(s) => (
                  <div className="flex flex-col gap-4">
                    <KeyValueGrid
                      items={[
                        { label: t('db.storage.total'), value: f.bytes(s.totalBytes), mono: true },
                        { label: t('db.storage.tables'), value: f.number(s.tables), mono: true },
                        { label: t('db.table.data'), value: f.bytes(s.dataBytes), mono: true },
                        { label: t('db.table.indexes'), value: f.bytes(s.indexBytes), mono: true },
                        { label: t('db.storage.growthToday'), value: formatSignedBytes(data.growthTodayBytes), mono: true },
                        { label: t('db.storage.growth30d'), value: formatSignedBytes(data.growth30dBytes), mono: true },
                      ]}
                    />
                    <div>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-muted">{t('db.storage.capacity')}</span>
                        <span className="font-mono tabular-nums text-fg-2">{data.limitBytes ? `${f.bytes(s.totalBytes)} / ${f.bytes(data.limitBytes)}` : NO_VALUE}</span>
                      </div>
                      {data.limitBytes ? <UsageBar percent={data.percent} thresholds={STORAGE_USAGE_THRESHOLDS} /> : <p className="text-xs text-faint">{t('db.storage.noLimit')}</p>}
                    </div>
                  </div>
                )}
              </DbSectionGate>
            )}
          </QueryView>
        </Panel>
        <MetricChart
          title={t('db.storage.growthChart')}
          hint={t('db.storage.historyNote')}
          series={growth}
          error={storage.error}
          onRetry={() => void storage.refetch()}
          format={(v) => f.bytes(v)}
          height="sm"
          emptyMessage={t('db.storage.noHistory')}
          className="min-w-0"
        />
      </PanelGrid>

      <Panel title={t('db.tables.title')} hint={t('db.tables.note')} flush>
        <QueryView query={tables}>
          {(data) => (
            <DbSectionGate section={data.tables} driver={overview?.driver} onRetry={() => void tables.refetch()}>
              {(list) => (
                <DataTable
                  data={list}
                  columns={columns}
                  getRowId={(r) => r.name}
                  onRowClick={(r) => page.openTable(r.name)}
                  activeRowId={page.tableName}
                  initialSorting={[{ id: 'totalBytes', desc: true }]}
                  maxHeight={DB_TABLE_MAX_HEIGHT_PX}
                  emptyMessage={t('db.tables.empty')}
                  footer={t('ui.table.rows', { count: list.length })}
                />
              )}
            </DbSectionGate>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

type Migration = DbMigrations['items'][number];
const migCol = createColumnHelper<Migration>();

function MigrationsView({ actions }: { actions: DbActions }) {
  const { t, locale, formatTime } = useLocale();
  const f = useFormat();
  const q = useLiveQuery(dbKeys.migrations(), () => databaseApi.migrations(), { tier: 'slow' });
  const d = q.data;
  const failed = d?.lastRun?.status === 'failed';

  const columns = useMemo(
    () => [
      migCol.accessor('name', { header: t('db.migrations.name'), meta: { mono: true, truncate: true } }),
      migCol.accessor('status', {
        header: t('db.migrations.status'),
        cell: (c) => (
          <Badge tone={c.getValue() === 'applied' ? 'ok' : 'warn'} size="xs">
            {t(`db.migrations.state.${c.getValue()}`)}
          </Badge>
        ),
        meta: { width: '120px' },
      }),
      migCol.accessor('timestamp', {
        header: t('db.migrations.created'),
        cell: (c) => (c.getValue() ? dateTime(c.getValue()!, locale, formatTime) : NO_VALUE),
        meta: { align: 'right', mono: true, width: '190px' },
      }),
    ],
    [t, locale, formatTime],
  );

  return (
    <>
      {d && d.pending > 0 && d.environment === 'production' && <StatusBanner tone="warn" title={t('db.migrations.pendingProd', { count: d.pending })} />}
      {failed && <StatusBanner tone="crit" title={t('db.migrations.lastFailedTitle')} description={d?.lastRun?.error ?? undefined} />}

      <StatGrid columns={4}>
        <StatTile label={t('db.migrations.applied')} value={d ? String(d.applied) : NO_VALUE} loading={!d && !q.isError} />
        <StatTile label={t('db.migrations.pending')} value={d ? String(d.pending) : NO_VALUE} tone={d ? (d.pending > 0 ? 'warn' : 'ok') : undefined} loading={!d && !q.isError} />
        <StatTile label={t('db.migrations.failed')} value={d ? (failed ? '1' : '0') : NO_VALUE} tone={d ? (failed ? 'crit' : 'ok') : undefined} loading={!d && !q.isError} />
        <StatTile
          label={t('db.migrations.lastRun')}
          value={d?.lastRun ? <RelativeTime value={d.lastRun.at} /> : NO_VALUE}
          sub={d?.lastRun ? t('db.migrations.lastRunSub', { count: d.lastRun.executed.length, duration: f.duration(d.lastRun.durationMs) }) : undefined}
          hint={d?.lastRun ? dateTime(d.lastRun.at, locale, formatTime, true) : undefined}
          loading={!d && !q.isError}
        />
      </StatGrid>

      <Panel
        title={t('db.migrations.title')}
        hint={d ? t('db.migrations.note', { table: d.tableName }) : undefined}
        flush
        actions={
          d ? (
            d.enabled ? (
              <Button size="xs" variant="danger" disabled={d.pending === 0} onClick={() => actions.requestMigrate(d)}>
                <Play />
                {t('db.migrations.run', { count: d.pending })}
              </Button>
            ) : (
              <Hint content={t('db.migrations.disabled')}>
                <span>
                  <Badge>{t('db.migrations.disabledShort')}</Badge>
                </span>
              </Hint>
            )
          ) : undefined
        }
      >
        <QueryView query={q}>
          {(data) => (
            <DataTable
              data={data.items}
              columns={columns}
              getRowId={(m) => m.name}
              rowTone={(m) => (m.status === 'pending' ? 'warn' : undefined)}
              maxHeight={DB_TABLE_MAX_HEIGHT_PX}
              emptyMessage={t('db.migrations.empty', { table: data.tableName })}
            />
          )}
        </QueryView>
      </Panel>
    </>
  );
}
