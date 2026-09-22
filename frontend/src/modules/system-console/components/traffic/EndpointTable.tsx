import React from 'react';
import type { EndpointRow, EndpointSort } from '../../types/traffic.types';
import { ENDPOINT_SORTS } from '../../constants/traffic';
import { formatMs, formatPct, formatRps, shortRoute } from '../../utils/traffic-format';
import { EndpointStatusBadge, MethodBadge } from './TrafficBadges';
import { useLocale } from '../../../../core/i18n/index';

interface EndpointTableProps {
  rows: EndpointRow[] | null;
  onOpen: (routeId: string) => void;
  sort?: EndpointSort;
  onSort?: (sort: EndpointSort) => void;
  /** Hiện cột module/percentile đầy đủ (tab Endpoints). */
  detailed?: boolean;
}

/** Hiệu năng theo endpoint; trạng thái do backend suy ra (Healthy / Slow / High error / Failing). */
export const EndpointTable: React.FC<EndpointTableProps> = ({ rows, onOpen, sort, onSort, detailed = false }) => {
  const { t } = useLocale();

  return (
    <>
      {onSort && sort && (
        <div className="tr-toolbar">
          <span className="tr-toolbar-label">{t('tr.endpoints.sortBy')}</span>
          <div className="ov-segmented" role="tablist" aria-label={t('tr.endpoints.sortBy')}>
            {ENDPOINT_SORTS.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={sort === s} className={sort === s ? 'is-active' : ''} onClick={() => onSort(s)}>
                {t(`tr.endpoints.sort.${s}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="scp-table-wrap">
        <table className="scp-table tr-table">
          <thead>
            <tr>
              <th>{t('tr.col.endpoint')}</th>
              <th className="is-num">{t('tr.col.rps')}</th>
              {detailed && <th className="is-num">{t('tr.col.requests')}</th>}
              <th className="is-num">{t('tr.col.avg')}</th>
              {detailed && <th className="is-num">P50</th>}
              <th className="is-num">P95</th>
              {detailed && <th className="is-num">P99</th>}
              <th className="is-num">{t('tr.col.errors5xx')}</th>
              {detailed && <th className="is-num">{t('tr.col.errors4xx')}</th>}
              <th>{t('tr.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={detailed ? 10 : 6} className="tr-empty-cell">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={detailed ? 10 : 6} className="tr-empty-cell">
                  {t('tr.endpoints.empty')}
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id} className={`rt-row-link ${r.stats.requests === 0 ? 'is-idle' : ''}`} onClick={() => onOpen(r.id)}>
                <td>
                  <span className="tr-endpoint">
                    <MethodBadge method={r.method} />
                    <code title={r.route}>{shortRoute(r.route)}</code>
                    {r.internal && <span className="tr-tag">{t('tr.internal')}</span>}
                  </span>
                </td>
                <td className="is-num">{formatRps(r.stats.requestsPerSecond)}</td>
                {detailed && <td className="is-num">{r.stats.requests.toLocaleString()}</td>}
                <td className="is-num">{formatMs(r.stats.avgLatencyMs)}</td>
                {detailed && <td className="is-num">{formatMs(r.stats.p50LatencyMs)}</td>}
                <td className="is-num">{formatMs(r.stats.p95LatencyMs)}</td>
                {detailed && <td className="is-num">{formatMs(r.stats.p99LatencyMs)}</td>}
                <td className={`is-num ${r.stats.serverErrors > 0 ? 'tr-bad' : ''}`}>{formatPct(r.stats.errorRatePercent)}</td>
                {detailed && <td className="is-num">{formatPct(r.stats.clientErrorRatePercent)}</td>}
                <td>
                  <EndpointStatusBadge status={r.status} title={r.reasons.map((x) => x.message).join(' · ')} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
