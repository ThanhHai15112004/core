import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ActiveRequests } from '../../types/traffic.types';
import { formatMs, shortRoute } from '../../utils/traffic-format';
import { MethodBadge } from './TrafficBadges';
import { useLocale } from '../../../../core/i18n/index';

/** Request đang xử lý (snapshot mỗi lần flush của từng instance). */
export const ActiveRequestsPanel: React.FC<{ data: ActiveRequests | null; now: number }> = ({ data, now }) => {
  const { t } = useLocale();
  const items = data?.items ?? [];
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('tr.active.title')}</h3>
        <span className="ov-section-hint">{t('tr.active.count', { count: items.length })}</span>
      </header>
      {items.length === 0 ? (
        <p className="ov-empty-line">{data ? t('tr.active.none') : t('common.loading')}</p>
      ) : (
        <div className="scp-table-wrap">
          <table className="scp-table tr-table">
            <thead>
              <tr>
                <th>{t('tr.col.endpoint')}</th>
                <th className="is-num">{t('tr.col.running')}</th>
                <th>{t('tr.col.instance')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                // Snapshot có độ trễ tối đa một chu kỳ flush; thời gian chạy tính lại theo đồng hồ hiện tại.
                const running = Math.max(a.runningMs, now - a.startedAt);
                const long = running >= (data?.longRunningMs ?? Infinity);
                return (
                  <tr key={a.id}>
                    <td>
                      <span className="tr-endpoint">
                        <MethodBadge method={a.method} />
                        <code title={a.route}>{shortRoute(a.path)}</code>
                      </span>
                    </td>
                    <td className={`is-num ${long ? 'tr-bad' : ''}`}>
                      {long && <AlertTriangle size={12} aria-label={t('tr.active.longRunning')} />} {formatMs(running)}
                    </td>
                    <td className="tr-muted">{a.instance}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
