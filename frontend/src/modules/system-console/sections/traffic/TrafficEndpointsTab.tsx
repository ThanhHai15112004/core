import { useMemo } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Panel, QueryView } from '@core/ui/blocks';
import type { EndpointRow } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import type { EndpointStatusFilter } from '../../constants/traffic';
import { TrafficFilterBar } from '../../components/traffic/TrafficFilterBar';
import { EndpointTable } from '../../components/traffic/EndpointTable';
import { trafficKeys } from './traffic-keys';
import type { TrafficPage } from './useTrafficPage';

function matches(r: EndpointRow, status: EndpointStatusFilter | undefined, q: string): boolean {
  if (status === '5xx' && r.stats.serverErrors === 0) return false;
  if (status === '4xx' && r.stats.clientErrors === 0) return false;
  if (status && status !== '5xx' && status !== '4xx' && r.status !== status) return false;
  if (q && !`${r.id} ${r.module}`.toLowerCase().includes(q.toLowerCase())) return false;
  return true;
}

/** Mọi endpoint (kể cả route chưa có request) — sort bằng header, lọc method / trạng thái / route, bấm mở chi tiết. */
export function TrafficEndpointsTab({ page }: { page: TrafficPage }) {
  const { t } = useLocale();
  const { filters, status, search, sortColumn, openEndpoint } = page;
  const query = useLiveQuery(trafficKeys.endpoints(filters), () => trafficApi.endpoints(filters, 'traffic'));
  const rows = useMemo(() => (query.data ?? []).filter((r) => matches(r, status, search.trim())), [query.data, status, search]);

  return (
    <>
      <TrafficFilterBar page={page} endpoints />
      <Panel
        title={t('tr.endpoints.title')}
        hint={t('tr.endpoints.hint')}
        flush
        actions={
          query.data ? (
            <span className="font-mono text-xs tabular-nums text-muted">{t('tr.endpoints.count', { shown: rows.length, total: query.data.length })}</span>
          ) : undefined
        }
      >
        <QueryView query={query} compact>
          {(all) => (
            <EndpointTable
              key={sortColumn}
              rows={rows}
              onOpen={openEndpoint}
              sortColumn={sortColumn}
              emptyMessage={t(all.length === 0 ? 'tr.endpoints.none' : 'tr.endpoints.empty')}
            />
          )}
        </QueryView>
      </Panel>
    </>
  );
}
