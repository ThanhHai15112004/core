import { useState } from 'react';
import { Activity } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { formatDuration, formatPercent, formatRate } from '../../lib/format';
import { Badge, Button } from '../primitives';
import {
  ActivityFeed,
  AlertList,
  ConfirmDialog,
  DataTable,
  DetailSection,
  DetailSheet,
  JsonView,
  KeyValueGrid,
  LevelBadge,
  PageHeader,
  Panel,
  PanelGrid,
  PanelState,
  StatGrid,
  StatTile,
  StatusBanner,
  Truncate,
  UsageBar,
} from '../blocks';
import { BarList, Gantt, Heatmap, StackedBarChart, TimeSeriesChart } from '../charts';
import { KIT_ALERTS, KIT_FEED, KIT_GANTT, KIT_HEAT, KIT_KINDS, KIT_LEVELS, KIT_NOW, KIT_OK, KIT_ROWS, KIT_SERIES, KIT_TEXT as T } from './kit.fixtures';

type Row = (typeof KIT_ROWS)[number];
const col = createColumnHelper<Row>();
const columns = [
  col.accessor('route', { header: T.table.route, meta: { truncate: true, mono: true } }),
  col.accessor('rps', { header: T.table.rps, cell: (c) => formatRate(c.getValue(), 'en'), meta: { align: 'right', mono: true, width: '90px' } }),
  col.accessor('p95', { header: T.table.p95, cell: (c) => formatDuration(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
  col.accessor('errors', { header: T.table.errors, cell: (c) => formatPercent(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
];
const MIN = 60_000;

/** Trang duyệt bộ UI dùng chung (chỉ bật ở dev: `/system-console/_kit`). */
export function KitPage() {
  const [confirm, setConfirm] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title={T.title} icon={Activity} description={T.description} status={{ tone: 'warn', label: 'warn' }} onSettings={() => setSheet(true)} actions={<Button size="sm" variant="primary" onClick={() => setConfirm(true)}>{T.confirm.open}</Button>} />
      <StatusBanner tone="warn" title={KIT_ALERTS[0].title} reasons={KIT_ALERTS.map((a) => ({ text: a.title, onClick: () => undefined }))} meta="v1.4.2" />

      <StatGrid columns={4}>
        <StatTile label={T.stat.requests} value="42.1" unit="/s" delta={{ text: '+12%', direction: 'up', good: null }} trend={KIT_SERIES[1].points.map((p) => p.v)} hint={T.stat.hint} sub={T.stat.sub} onClick={() => undefined} />
        <StatTile label={T.stat.p95} value="940" unit="ms" tone="warn" delta={{ text: '+38%', direction: 'up', good: false }} trend={KIT_SERIES[0].points.map((p) => p.v)} />
        <StatTile label={T.stat.errors} value="5.1" unit="%" tone="crit" delta={{ text: '-2%', direction: 'down', good: true }} />
        <StatTile label={T.stat.cpu} value="—" loading />
      </StatGrid>

      <PanelGrid layout="2-1">
        <Panel title={T.chart.latency} hint={T.stat.hint} expandable>
          <TimeSeriesChart
            series={KIT_SERIES}
            format={(v) => formatDuration(v)}
            thresholds={[{ value: 400, label: 'SLO 400 ms', tone: 'crit' }]}
            markers={[{ t: KIT_NOW - 30 * MIN, label: 'deploy', tone: 'info' }]}
            bands={[{ from: KIT_NOW - 22 * MIN, to: KIT_NOW - 18 * MIN, tone: 'warn' }]}
            legend
            ariaLabel={T.chart.latency}
          />
        </Panel>
        <Panel title={T.chart.bars}>
          <BarList items={KIT_ROWS.map((r) => ({ id: r.id, label: r.route, value: r.p95, display: formatDuration(r.p95), tone: r.p95 > 800 ? 'crit' : undefined, onClick: () => undefined }))} />
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel title={T.chart.levels}>
          <StackedBarChart series={KIT_LEVELS} format={(v) => String(v ?? 0)} height="sm" ariaLabel={T.chart.levels} onTimeClick={() => undefined} />
        </Panel>
        <Panel title={T.chart.heat}>
          <Heatmap xLabels={KIT_HEAT.x} yLabels={KIT_HEAT.y} cells={KIT_HEAT.cells} format={(v) => String(v)} height="sm" ariaLabel={T.chart.heat} />
        </Panel>
      </PanelGrid>

      <Panel title={T.chart.gantt} className="mb-4">
        <Gantt rows={KIT_GANTT.rows} items={KIT_GANTT.items} xRange={{ from: KIT_NOW - 60 * MIN, to: KIT_NOW }} ariaLabel={T.chart.gantt} />
      </Panel>

      <Panel title={T.sections.table} flush className="mb-4">
        <DataTable data={KIT_ROWS} columns={columns} getRowId={(r) => r.id} onRowClick={(r) => setActive(r.id)} activeRowId={active} rowTone={(r) => (r.errors > 1 ? 'crit' : undefined)} initialSorting={[{ id: 'p95', desc: true }]} />
      </Panel>

      <PanelGrid>
        <Panel title={T.sections.alerts}>
          <AlertList items={KIT_ALERTS} okChecks={KIT_OK} />
        </Panel>
        <Panel title={T.sections.alerts}>
          <ActivityFeed items={KIT_FEED} kinds={KIT_KINDS} />
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel title={T.sections.misc} bodyClassName="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="ok">ok</Badge>
            <Badge tone="warn">warn</Badge>
            <Badge tone="crit">crit</Badge>
            <Badge tone="info" variant="outline">info</Badge>
            <Badge>neutral</Badge>
            {(['fatal', 'error', 'warn', 'info', 'debug'] as const).map((l) => (
              <LevelBadge key={l} level={l} />
            ))}
          </div>
          <UsageBar label="CPU" percent={34} thresholds={{ warn: 70, crit: 90 }} />
          <UsageBar label="RAM" percent={82} thresholds={{ warn: 70, crit: 90 }} />
          <UsageBar label="Disk" percent={null} />
          <Truncate text={T.longText} expandable />
          <JsonView value={{ queue: 'emails', attempts: 3, ok: false, payload: { to: 'user@example.com', ids: [1, 2] }, error: null }} />
        </Panel>
        <Panel title={T.sections.states} bodyClassName="grid grid-cols-2 gap-3">
          <PanelState status="loading" />
          <PanelState status="error" error={new Error('ECONNREFUSED 127.0.0.1:3005')} onRetry={() => undefined} compact />
          <PanelState status="empty" compact />
          <PanelState status="no-source" compact />
        </Panel>
      </PanelGrid>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={T.confirm.title} impact={T.confirm.impact} confirmLabel={T.confirm.confirm} tone="danger" typeToConfirm="session" onConfirm={() => setConfirm(false)} />
      <DetailSheet
        open={sheet}
        onOpenChange={setSheet}
        title={T.sheet.title}
        status={{ tone: 'crit', label: 'crit' }}
        tabs={[
          { id: 'a', label: 'Overview', content: <DetailSection title="Info"><KeyValueGrid items={[{ label: 'p95', value: '940 ms', mono: true }, { label: 'Owner', value: null }]} /></DetailSection> },
          { id: 'b', label: 'Payload', content: <JsonView value={{ a: 1 }} /> },
        ]}
      />
    </div>
  );
}
