import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { AuditDomain, AuditEvent, AuditList, LogsWindow } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { ApiError } from '../../../../core/services/api';
import { AuditTable } from '../../components/logs/AuditTable';
import { AUDIT_DOMAINS, LOGS_WINDOWS } from '../../constants/logs';
import { useLocale } from '../../../../core/i18n/index';

/**
 * Audit — tách khỏi application log: ai đã thao tác gì trên hệ thống (xoá cache, retry job, tắt task, đổi log level,
 * export…). Chỉ xem / tìm; không có xoá — retention theo cấu hình từng module.
 */
export const LogsAuditView: React.FC<{ paused: boolean; reloadKey: number; navigate: (p: string) => void }> = ({ reloadKey, navigate }) => {
  const { t, formatRelative } = useLocale();
  const [domain, setDomain] = useState<AuditDomain | ''>('');
  const [result, setResult] = useState<'success' | 'failed' | ''>('');
  const [win, setWin] = useState<LogsWindow | ''>('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [data, setData] = useState<AuditList | null>(null);
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const query = { domain: domain || undefined, result: result || undefined, window: win || undefined, q: applied || undefined };
  const key = JSON.stringify(query);

  useEffect(() => {
    let alive = true;
    setError(null);
    logsApi
      .audit(query)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setRows(d.items);
      })
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadKey]);

  const more = async () => {
    if (!data?.nextCursor) return;
    const d = await logsApi.audit(query, data.nextCursor);
    setData(d);
    setRows((r) => [...r, ...d.items]);
  };

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <div>
          <h3>{t('logs.audit.title')}</h3>
          <p className="lg-note">{t('logs.audit.subtitle')}</p>
        </div>
      </header>
      <div className="lg-filter-row">
        <label>
          <span>{t('logs.audit.domainLabel')}</span>
          <select value={domain} onChange={(e) => setDomain(e.target.value as AuditDomain | '')}>
            <option value="">{t('logs.filter.all')}</option>
            {AUDIT_DOMAINS.map((d) => (
              <option key={d} value={d}>
                {t(`logs.audit.domain.${d}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('logs.audit.result')}</span>
          <select value={result} onChange={(e) => setResult(e.target.value as 'success' | 'failed' | '')}>
            <option value="">{t('logs.filter.all')}</option>
            <option value="success">{t('cache.ops.status.success')}</option>
            <option value="failed">{t('cache.ops.status.failed')}</option>
          </select>
        </label>
        <label>
          <span>{t('logs.filter.time')}</span>
          <select value={win} onChange={(e) => setWin(e.target.value as LogsWindow | '')}>
            <option value="">{t('logs.audit.allTime')}</option>
            {LOGS_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {t(`logs.window.${w}`)}
              </option>
            ))}
          </select>
        </label>
        <form
          className="lg-search-box lg-search-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(q.trim());
          }}
        >
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('logs.audit.search')} aria-label={t('logs.audit.search')} />
        </form>
      </div>
      {error && <p className="scp-alert scp-alert-danger">{error}</p>}
      {data && rows.length === 0 ? <p className="ov-empty-line">{t('logs.audit.empty')}</p> : <AuditTable rows={rows} navigate={navigate} />}
      {data?.nextCursor && (
        <div className="lg-older">
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => void more()}>
            {t('logs.explorer.older')}
          </button>
        </div>
      )}
      {data && (
        <p className="pf-chart-note">
          {t('logs.audit.retention', {
            total: data.total,
            sources: data.domains
              .filter((d) => d.entries > 0)
              .map((d) => `${t(`logs.audit.domain.${d.domain}`)} ${d.entries}${d.oldestAt ? ` (${formatRelative(d.oldestAt)})` : ''}`)
              .join(' · '),
          })}
        </p>
      )}
    </section>
  );
};
