import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { DataTable, Panel, PanelGrid } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { ErrorAnalysis as ErrorAnalysisData } from '../../types/traffic.types';
import { EndpointLabel } from './TrafficBadges';
import { httpStatusTone } from '../../utils/traffic-format';
import { useTrafficFormat } from './useTrafficFormat';

type ErrorRoute = ErrorAnalysisData['topRoutes'][number];
const col = createColumnHelper<ErrorRoute>();

interface ErrorAnalysisProps {
  data: ErrorAnalysisData;
  onOpenRoute: (routeId: string) => void;
  onSelectStatus: (status: string) => void;
}

/** Endpoint lỗi nhiều nhất (4xx / 5xx) và status lỗi nhiều nhất (bấm → Logs lọc theo status). */
export function ErrorAnalysis({ data, onOpenRoute, onSelectStatus }: ErrorAnalysisProps) {
  const { t } = useLocale();
  const tf = useTrafficFormat();
  const columns = useMemo(
    () => [
      col.accessor('routeId', {
        header: t('tr.col.endpoint'),
        cell: (c) => <EndpointLabel method={c.row.original.method} route={c.row.original.route} />,
        enableSorting: false,
      }),
      col.accessor('serverErrors', {
        header: t('tr.col.count5xx'),
        cell: (c) => <span className={c.getValue() > 0 ? 'text-crit-fg' : 'text-faint'}>{tf.count(c.getValue())}</span>,
        meta: { align: 'right', mono: true, width: '96px' },
      }),
      col.accessor('clientErrors', {
        header: t('tr.col.count4xx'),
        cell: (c) => <span className={c.getValue() > 0 ? 'text-warn-fg' : 'text-faint'}>{tf.count(c.getValue())}</span>,
        meta: { align: 'right', mono: true, width: '96px' },
      }),
    ],
    [t, tf],
  );

  return (
    <PanelGrid layout="2-1">
      <Panel title={t('tr.errors.topRoutes')} flush>
        <DataTable
          data={data.topRoutes}
          columns={columns}
          getRowId={(r) => r.routeId}
          onRowClick={(r) => onOpenRoute(r.routeId)}
          rowTone={(r) => (r.serverErrors > 0 ? 'crit' : 'warn')}
          initialSorting={[{ id: 'serverErrors', desc: true }]}
          emptyMessage={t('tr.errors.none')}
        />
      </Panel>
      <Panel title={t('tr.errors.topStatuses')} hint={t('tr.errors.statusHint')}>
        {data.topStatuses.length === 0 ? (
          <p className="py-2 text-sm text-faint">{t('tr.errors.none')}</p>
        ) : (
          <BarList
            items={data.topStatuses.map((s) => ({
              id: String(s.status),
              label: <span className="font-mono">{s.status}</span>,
              value: s.count,
              display: tf.count(s.count),
              tone: httpStatusTone(s.status),
              onClick: () => onSelectStatus(String(s.status)),
            }))}
          />
        )}
      </Panel>
    </PanelGrid>
  );
}
