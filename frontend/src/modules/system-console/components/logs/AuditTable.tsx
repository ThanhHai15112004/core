import React from 'react';
import type { AuditEvent } from '../../types/logs.types';
import { AUDIT_SECTION } from '../../constants/logs';
import { formatDuration } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

/** `retry_failed` → `Retry failed` khi chưa có bản dịch riêng. */
const humanize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

/** Audit: ai đã làm gì, lúc nào, trên đối tượng nào, kết quả — chỉ xem (append-only). */
export const AuditTable: React.FC<{ rows: AuditEvent[]; navigate: (path: string) => void; compact?: boolean }> = ({ rows, navigate, compact = false }) => {
  const { t, formatTime } = useLocale();
  const actionLabel = (e: AuditEvent) => {
    const key = `logs.audit.action.${e.domain}.${e.action}`;
    const v = t(key);
    return v === key ? humanize(e.action) : v;
  };
  return (
    <div className="scp-table-wrap">
      <table className="scp-table">
        <thead>
          <tr>
            <th>{t('logs.audit.time')}</th>
            <th>{t('logs.audit.actor')}</th>
            <th>{t('logs.audit.actionCol')}</th>
            {!compact && <th>{t('logs.audit.target')}</th>}
            <th>{t('logs.audit.result')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td>
                {!compact && `${new Date(e.at).toLocaleDateString()} `}
                {formatTime(e.at, true)}
              </td>
              <td>
                {e.actor === 'system' ? t('logs.audit.system') : (e.actor ?? t('cache.ops.anonymous'))}
                {e.ip && !compact && <small className="pf-row-note">{e.ip}</small>}
              </td>
              <td>
                <button type="button" className="ov-link" onClick={() => navigate(AUDIT_SECTION[e.domain])}>
                  <span className="lg-tag">{t(`logs.audit.domain.${e.domain}`)}</span>
                </button>{' '}
                {actionLabel(e)}
                {compact && e.target && <small className="pf-row-note">{e.target}</small>}
                {e.detail && !compact && <small className="pf-row-note">{e.detail}</small>}
              </td>
              {!compact && <td className="cache-key-cell">{e.target ? <code>{e.target}</code> : '—'}</td>}
              <td>
                <span className={`pf-chip ov-tone-${e.result === 'success' ? 'ok' : 'crit'}`}>{t(`cache.ops.status.${e.result}`)}</span>
                {e.durationMs !== null && !compact && <small className="pf-row-note">{formatDuration(e.durationMs)}</small>}
                {e.error && <small className="pf-row-note">{e.error}</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
