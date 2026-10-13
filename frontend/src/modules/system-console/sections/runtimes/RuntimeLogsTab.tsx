import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Button } from '@core/ui/primitives';
import { ActivityFeed, DataTable, Panel, PanelGrid, PanelState } from '@core/ui/blocks';
import type { RestartHistoryItem, RuntimeDetail } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { BAD_RESTART_CODES, DETAIL_EVENTS_LIMIT, DETAIL_LOGS_LIMIT, EVENTS_MAX_HEIGHT_PX } from '../../constants/runtime-metrics';
import { RuntimeLogs } from '../../components/runtimes/RuntimeLogs';
import { eventToActivity, useDateTime } from '../../components/runtimes/runtime-view';
import { runtimesKeys } from './runtimes-keys';
import type { RuntimesPage } from './useRuntimesPage';

const col = createColumnHelper<RestartHistoryItem>();

/** Logs & Sự kiện: log gần nhất (lọc level) → sự kiện vòng đời + lịch sử restart. */
export function RuntimeLogsTab({ d, page }: { d: RuntimeDetail; page: RuntimesPage }) {
  const { t } = useLocale();
  const f = useFormat();
  const dateTime = useDateTime();
  const events = useLiveQuery(runtimesKeys.events(DETAIL_EVENTS_LIMIT, d.id), () => runtimesApi.events(DETAIL_EVENTS_LIMIT, d.id));
  const columns = useMemo(
    () => [
      col.accessor('at', { header: t('rt.restartHistory.time'), cell: (c) => dateTime(c.getValue()), meta: { mono: true, width: '180px', className: 'whitespace-nowrap' } }),
      col.accessor('reason', { header: t('rt.restartHistory.reason'), meta: { truncate: true } }),
      col.accessor('downtimeMs', { header: t('rt.restartHistory.downtime'), cell: (c) => f.duration(c.getValue()), meta: { mono: true, align: 'right', width: '96px' } }),
      col.accessor('exitCode', { header: t('rt.restartHistory.exitCode'), cell: (c) => f.number(c.getValue()), meta: { mono: true, align: 'right', width: '84px' } }),
    ],
    [t, f, dateTime],
  );

  return (
    <>
      <Panel title={t('rt.logs.title')} className="mb-4">
        <RuntimeLogs
          runtime={d.id}
          limit={DETAIL_LOGS_LIMIT}
          actions={
            <Button size="xs" variant="ghost" onClick={() => page.navigate(`logs/explorer?runtime=${d.id}`)}>
              {t('rt.logs.openViewer')}
              <ArrowRight />
            </Button>
          }
        />
      </Panel>
      <PanelGrid>
        <Panel title={t('rt.events.title')}>
          {events.data ? (
            <ActivityFeed items={events.data.map((e) => eventToActivity(e, false))} emptyMessage={t('rt.events.empty')} maxHeight={EVENTS_MAX_HEIGHT_PX} />
          ) : (
            <PanelState status={events.isError ? 'error' : 'loading'} error={events.error} onRetry={() => void events.refetch()} />
          )}
        </Panel>
        <Panel title={t('rt.restartHistory.title')} flush>
          <DataTable
            data={d.restartHistory}
            columns={columns}
            getRowId={(h) => h.at}
            emptyMessage={t('rt.restartHistory.empty')}
            rowTone={(h) => (BAD_RESTART_CODES.includes(h.reasonCode) ? 'crit' : undefined)}
            maxHeight={EVENTS_MAX_HEIGHT_PX}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
