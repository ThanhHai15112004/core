import React from 'react';
import type { RequestSummary } from '../../types/traffic.types';
import { formatMs, shortRoute } from '../../utils/traffic-format';
import { HttpStatusBadge, MethodBadge } from './TrafficBadges';
import { useLocale } from '../../../../core/i18n/index';

interface RequestTableProps {
  items: RequestSummary[] | null;
  onOpen: (id: string) => void;
  emptyText: string;
  slowMs?: number;
}

/** Bảng request (log nhẹ từ backend). Bấm một dòng → Request Detail. */
export const RequestTable: React.FC<RequestTableProps> = ({ items, onOpen, emptyText, slowMs }) => {
  const { t, formatTime } = useLocale();
  return (
    <div className="scp-table-wrap">
      <table className="scp-table tr-table">
        <thead>
          <tr>
            <th>{t('tr.col.time')}</th>
            <th>{t('tr.col.endpoint')}</th>
            <th>{t('tr.col.status')}</th>
            <th className="is-num">{t('tr.col.duration')}</th>
            <th>{t('tr.col.error')}</th>
            <th>{t('tr.col.instance')}</th>
            <th>{t('tr.col.requestId')}</th>
          </tr>
        </thead>
        <tbody>
          {items === null && (
            <tr>
              <td colSpan={7} className="tr-empty-cell">
                {t('common.loading')}
              </td>
            </tr>
          )}
          {items?.length === 0 && (
            <tr>
              <td colSpan={7} className="tr-empty-cell">
                {emptyText}
              </td>
            </tr>
          )}
          {items?.map((r) => (
            <tr key={r.id} className="rt-row-link" onClick={() => onOpen(r.id)}>
              <td className="tr-mono">{formatTime(r.at)}</td>
              <td>
                <span className="tr-endpoint">
                  <MethodBadge method={r.method} />
                  <code title={r.route}>{shortRoute(r.path)}</code>
                </span>
              </td>
              <td>
                <HttpStatusBadge status={r.status} />
              </td>
              <td className={`is-num ${slowMs !== undefined && r.durationMs >= slowMs ? 'tr-bad' : ''}`}>{formatMs(r.durationMs)}</td>
              <td className="tr-muted">{r.errorCode ?? ''}</td>
              <td className="tr-muted">{r.instance}</td>
              <td className="tr-mono tr-muted" title={r.id}>
                {r.id.slice(0, 12)}…{r.captured && <span className="tr-dot" title={t('tr.requests.captured')} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
