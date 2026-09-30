import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { WorkerEvent, WorkerRange } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { usePolling } from '../../hooks/usePolling';
import { WorkerEventList } from '../../components/worker/WorkerEventList';
import { formatCompact, formatDuration } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Dòng thời gian sự kiện (queue, cảnh báo, worker restart) + audit mọi thao tác queue. */
export const WorkerEventsView: React.FC<{ range: WorkerRange; paused: boolean; reloadKey: number; openEvent: (e: WorkerEvent) => void }> = ({
  range,
  paused,
  reloadKey,
  openEvent,
}) => {
  const { t, formatTime } = useLocale();
  const events = usePolling(() => workerApi.events(range), `wq-events:${range}:${reloadKey}`, undefined, paused);
  const ops = usePolling(() => workerApi.operations(), `wq-ops:${reloadKey}`, undefined, paused);
  return (
    <>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.events.title')}</h3>
          <span className="ov-section-hint">{t(`tr.range.${range}`)}</span>
        </header>
        <WorkerEventList events={events.data} onOpen={openEvent} emptyText={t('wq.events.empty')} />
      </section>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.audit.title')}</h3>
          <span className="ov-section-hint">{t('wq.audit.hint')}</span>
        </header>
        {ops.data && ops.data.length === 0 ? (
          <p className="ov-empty-line">{t('wq.audit.empty')}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('db.errors.time')}</th>
                  <th>{t('cache.ops.actor')}</th>
                  <th>{t('cache.ops.action')}</th>
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
                    <td className="cache-key-cell">
                      {t(`wq.audit.kind.${o.action}`)} <code>{o.target}</code>
                      {o.detail && <small className="pf-row-note">{o.detail}</small>}
                    </td>
                    <td>
                      <span className={`pf-chip ov-tone-${o.result === 'success' ? 'ok' : 'crit'}`}>{t(`cache.ops.status.${o.result}`)}</span>{' '}
                      <small className="pf-row-note">{formatDuration(o.durationMs)}</small>
                      {o.error && <small className="pf-row-note">{o.error}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="pf-chart-note">{t('wq.audit.note')}</p>
      </section>
    </>
  );
};

/** Cấu hình đang nạp: provider, worker, job mặc định, ngưỡng, quyền thao tác. */
export const WorkerConfigView: React.FC = () => {
  const { t, locale } = useLocale();
  const { data } = usePolling(() => workerApi.config(), 'worker-config', 60_000);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!data) return;
    void navigator.clipboard?.writeText(JSON.stringify(Object.fromEntries(data.items.map((i) => [i.key, i.value])), null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const MS_KEYS = ['backoffDelayMs', 'processingP95Ms'];
  const render = (item: NonNullable<typeof data>['items'][number]) => {
    if (typeof item.value === 'boolean') return item.value ? t('db.config.yes') : t('db.config.no');
    if (item.value === null) return NO_VALUE;
    if (MS_KEYS.includes(item.key)) return formatDuration(Number(item.value));
    if (item.key === 'backoff') return t(`wq.config.value.backoff.${item.value}`);
    if (typeof item.value === 'number') return formatCompact(item.value, locale);
    return String(item.value);
  };
  const groups = [...new Set(data?.items.map((i) => i.group) ?? [])];
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('wq.config.title')}</h3>
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={copy} disabled={!data}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : t('db.config.copy')}
        </button>
      </header>
      {groups.map((g) => (
        <div key={g} className="cache-config-group">
          <h4>{t(`wq.config.group.${g}`)}</h4>
          <div className="scp-table-wrap">
            <table className="scp-table tr-kv-table">
              <tbody>
                {data?.items
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <tr key={i.key}>
                      <th>{t(`wq.config.key.${i.key}`)}</th>
                      <td>
                        <code>{render(i)}</code>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="pf-chart-note">{t('wq.config.note')}</p>
    </section>
  );
};
