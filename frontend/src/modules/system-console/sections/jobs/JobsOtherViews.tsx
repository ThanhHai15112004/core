import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { JobsRange } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { usePolling } from '../../hooks/usePolling';
import { JobEventList } from '../../components/jobs/JobEventList';
import { formatCompact } from '../../utils/database-format';
import { formatMs } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const MS_KEYS = new Set(['backoffDelayMs', 'lockDurationMs']);
const SEC_KEYS = new Set(['longRunningMinSec', 'longWaitMinSec', 'criticalWaitSec']);

/** Sự kiện job + audit mọi thao tác (retry / huỷ / xoá / xem payload: ai, khi nào, job nào, lý do, kết quả). */
export const JobsEventsView: React.FC<{
  range: JobsRange;
  paused: boolean;
  reloadKey: number;
  now: number;
  openJob: (id: string, queue?: string | null) => void;
}> = ({ range, paused, reloadKey, openJob }) => {
  const { t, formatTime } = useLocale();
  const events = usePolling(() => jobsApi.events(range), `jobs-events:${range}:${reloadKey}`, undefined, paused);
  const ops = usePolling(() => jobsApi.operations(), `jobs-ops:${reloadKey}`, undefined, paused);
  const openTarget = (target: string) => {
    const i = target.indexOf('|');
    if (i > 0) openJob(target.slice(i + 1), target.slice(0, i));
  };
  return (
    <>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('jobs.events.title')}</h3>
          <span className="ov-section-hint">{t(`tr.range.${range}`)}</span>
        </header>
        <JobEventList events={events.data} onOpenJob={openJob} emptyText={t('jobs.events.none')} />
        <p className="pf-chart-note">{t('jobs.events.note')}</p>
      </section>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('jobs.audit.title')}</h3>
          <span className="ov-section-hint">{t('jobs.audit.hint')}</span>
        </header>
        {ops.data && ops.data.length === 0 ? (
          <p className="ov-empty-line">{t('jobs.audit.empty')}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('db.errors.time')}</th>
                  <th>{t('cache.ops.actor')}</th>
                  <th>{t('cache.ops.action')}</th>
                  <th>{t('jobs.audit.job')}</th>
                  <th>{t('jobs.audit.reason')}</th>
                  <th>{t('cache.ops.result')}</th>
                </tr>
              </thead>
              <tbody>
                {ops.data?.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {new Date(o.at).toLocaleDateString()} {formatTime(Date.parse(o.at), true)}
                    </td>
                    <td>
                      {o.actor ?? t('cache.ops.anonymous')}
                      {o.ip && <small className="pf-row-note">{o.ip}</small>}
                    </td>
                    <td>{t(`jobs.audit.action.${o.action}`)}</td>
                    <td>
                      {o.target.includes('|') ? (
                        <button type="button" className="ov-link" onClick={() => openTarget(o.target)}>
                          <code>{o.target.split('|')[1]!.slice(0, 8)}</code> {o.jobType}
                        </button>
                      ) : (
                        o.target
                      )}
                      {o.detail && <small className="pf-row-note">{o.detail}</small>}
                    </td>
                    <td>{o.reason ?? NO_VALUE}</td>
                    <td>
                      <span className={`pf-chip ov-tone-${o.result === 'success' ? 'ok' : 'crit'}`}>{t(`jobs.audit.result.${o.result}`)}</span>
                      {o.error && <small className="pf-row-note">{o.error}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
};

/** Cấu hình Jobs: provider, mặc định job, retention, ngưỡng, quyền thao tác (đổi qua env). */
export const JobsConfigView: React.FC = () => {
  const { t, locale } = useLocale();
  const { data } = usePolling(() => jobsApi.config(), 'jobs-config', 60_000);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!data) return;
    void navigator.clipboard?.writeText(JSON.stringify(Object.fromEntries(data.items.map((i) => [i.key, i.value])), null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const render = (key: string, value: string | number | boolean | null) => {
    if (typeof value === 'boolean') return value ? t('db.config.yes') : t('db.config.no');
    if (value === null) return NO_VALUE;
    if (MS_KEYS.has(key)) return formatMs(Number(value));
    if (SEC_KEYS.has(key)) return formatMs(Number(value) * 1000);
    if (typeof value === 'number') return formatCompact(value, locale);
    return String(value);
  };
  const groups = [...new Set(data?.items.map((i) => i.group) ?? [])];
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('jobs.config.title')}</h3>
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={copy} disabled={!data}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : t('db.config.copy')}
        </button>
      </header>
      {groups.map((g) => (
        <div key={g} className="cache-config-group">
          <h4>{t(`jobs.config.group.${g}`)}</h4>
          <div className="scp-table-wrap">
            <table className="scp-table tr-kv-table">
              <tbody>
                {data?.items
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <tr key={i.key}>
                      <th>{t(`jobs.config.key.${i.key}`)}</th>
                      <td>
                        <code>{render(i.key, i.value)}</code>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="pf-chart-note">{t('jobs.config.note')}</p>
    </section>
  );
};
