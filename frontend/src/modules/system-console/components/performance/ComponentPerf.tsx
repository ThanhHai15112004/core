import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Badge, Button } from '@core/ui/primitives';
import { AlertList, ComparisonTable, DataTable, DetailSection, DetailSheet, QueryView, StatusDot, type ComparisonRow } from '@core/ui/blocks';
import type { ComponentDetail, ComponentId, ComponentRow, PerfRange } from '../../types/performance.types';
import { performanceApi } from '../../services/performance.api';
import { COMPONENT_TONE, HIGHER_IS_WORSE, SEVERITY_TONE } from '../../constants/performance';
import { perfKeys } from '../../sections/performance/performance-keys';
import { shortRoute, usePerfFormat } from './perf-format';

const col = createColumnHelper<ComponentRow>();
type Endpoint = ComponentDetail['endpoints'][number];
const epCol = createColumnHelper<Endpoint>();

function StatusBadge({ status }: { status: ComponentRow['status'] }) {
  const { t } = useLocale();
  const tone = COMPONENT_TONE[status];
  return (
    <Badge tone={tone}>
      <StatusDot tone={tone} size="xs" />
      {t(`perf.componentStatus.${status}`)}
    </Badge>
  );
}

/** Hiệu năng theo thành phần: tải, latency, lỗi, trạng thái. Bấm hàng → drawer chi tiết. */
export function ComponentTable({ rows, activeId, onOpen }: { rows: ComponentRow[]; activeId: string | null; onOpen: (id: ComponentId) => void }) {
  const { t } = useLocale();
  const fmt = usePerfFormat();
  const columns = useMemo(
    () => [
      col.accessor('id', {
        header: t('perf.components.component'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="font-medium text-fg">{t(`perf.component.${c.getValue()}`)}</div>
            {c.row.original.note && <div className="truncate text-2xs text-faint">{c.row.original.note}</div>}
          </div>
        ),
      }),
      col.accessor('load', { header: t('perf.components.load'), cell: (c) => fmt(c.getValue(), c.row.original.loadUnit), meta: { mono: true, align: 'right' } }),
      col.accessor('latencyMs', {
        header: t('perf.components.latency'),
        cell: (c) => (
          <>
            {fmt(c.getValue(), 'ms')}
            {c.getValue() !== null && <span className="ml-1 text-2xs text-faint">{t(`perf.components.latencyKind.${c.row.original.latencyKind}`)}</span>}
          </>
        ),
        meta: { mono: true, align: 'right' },
      }),
      col.accessor('errorPercent', { header: t('perf.components.errors'), cell: (c) => fmt(c.getValue(), '%'), meta: { mono: true, align: 'right' } }),
      col.accessor('status', { header: t('perf.components.status'), cell: (c) => <StatusBadge status={c.getValue()} /> }),
    ],
    [t, fmt],
  );
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      onRowClick={(r) => onOpen(r.id)}
      activeRowId={activeId}
      rowTone={(r) => {
        const tone = COMPONENT_TONE[r.status];
        return tone === 'warn' || tone === 'crit' ? tone : undefined;
      }}
    />
  );
}

interface ComponentSheetProps {
  id: ComponentId | null;
  range: PerfRange;
  onClose: () => void;
  navigate: (path: string) => void;
}

/** Drawer một thành phần: chỉ số so với kỳ trước, điểm nghẽn, endpoint chậm, lối sang màn chuyên sâu. */
export function ComponentSheet({ id, range, onClose, navigate }: ComponentSheetProps) {
  const { t } = useLocale();
  const fmt = usePerfFormat();
  const query = useLiveQuery(perfKeys.component(id ?? 'api', range), () => performanceApi.component(id ?? 'api', range), { enabled: Boolean(id), keepPrevious: false });
  const d = query.data;
  const epColumns = useMemo(
    () => [
      epCol.accessor((e) => `${e.method} ${shortRoute(e.route)}`, { id: 'route', header: t('perf.drawer.endpoint'), meta: { mono: true, truncate: true } }),
      epCol.accessor('p95Ms', { header: t('perf.drawer.p95'), cell: (c) => fmt(c.getValue(), 'ms'), meta: { mono: true, align: 'right', width: '90px' } }),
      epCol.accessor('requests', { header: t('perf.drawer.requests'), cell: (c) => fmt(c.getValue(), ''), meta: { mono: true, align: 'right', width: '90px' } }),
    ],
    [t, fmt],
  );

  return (
    <DetailSheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      title={id ? t('perf.drawer.title', { name: t(`perf.component.${id}`) }) : ''}
      subtitle={d?.note ?? undefined}
      status={d ? { tone: COMPONENT_TONE[d.status], label: t(`perf.componentStatus.${d.status}`) } : undefined}
      actions={
        d && id && d.target !== `performance/components/${id}` ? (
          <Button size="sm" onClick={() => navigate(d.target)}>
            {t(`perf.drawer.openTarget.${id}`)}
            <ArrowRight />
          </Button>
        ) : undefined
      }
      width="lg"
    >
      <QueryView query={query}>
        {(data) => (
          <>
            <DetailSection title={t('perf.drawer.metrics', { range: t(`ui.time.ranges.${range}`) })}>
              <ComparisonTable
                labels={{ current: t('perf.drawer.current'), previous: t('perf.drawer.previous') }}
                rows={data.metrics.map(
                  (m): ComparisonRow => ({
                    id: m.key,
                    label: m.label,
                    current: m.value,
                    previous: m.baseline,
                    format: (v) => fmt(v, m.unit),
                    higherIsWorse: HIGHER_IS_WORSE.has(m.key) ? true : null,
                  }),
                )}
              />
            </DetailSection>
            {data.bottlenecks.length > 0 && (
              <DetailSection title={t('perf.bottlenecks.title')}>
                <AlertList items={data.bottlenecks.map((b) => ({ id: b.id, tone: SEVERITY_TONE[b.severity], title: b.title, detail: b.message, since: b.since }))} />
              </DetailSection>
            )}
            {data.endpoints.length > 0 && (
              <DetailSection title={t('perf.drawer.slowEndpoints')}>
                <DataTable
                  data={data.endpoints}
                  columns={epColumns}
                  getRowId={(e) => e.routeId}
                  onRowClick={(e) => navigate(`http-traffic/endpoints/${e.routeId}`)}
                  className="rounded-md border border-border"
                />
              </DetailSection>
            )}
          </>
        )}
      </QueryView>
    </DetailSheet>
  );
}
