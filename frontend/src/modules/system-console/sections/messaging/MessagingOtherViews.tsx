import React, { useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import type { MessagingErrorKind, MessagingEvent, MessagingRange } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { usePolling } from '../../hooks/usePolling';
import { MessagingEventList } from '../../components/messaging/MessagingEventList';
import { formatCompact, formatDuration } from '../../utils/database-format';
import { shortId } from '../../utils/messaging-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const KINDS: MessagingErrorKind[] = ['processing', 'timeout', 'deserialize', 'publish', 'connection', 'stalled', 'other'];

/** Lỗi theo loại & giai đoạn (publish/consume), bảng lỗi (→ message, → log), dòng thời gian sự kiện. */
export const MessagingErrorsView: React.FC<{
  range: MessagingRange;
  paused: boolean;
  reloadKey: number;
  openEvent: (e: MessagingEvent) => void;
  openMessage: (id: string, queue: string) => void;
  navigate: (p: string) => void;
}> = ({ range, paused, reloadKey, openEvent, openMessage, navigate }) => {
  const { t, formatTime } = useLocale();
  const errors = usePolling(() => messagingApi.errors(range), `errors:${range}:${reloadKey}`, undefined, paused);
  const events = usePolling(() => messagingApi.events(range), `events:${range}:${reloadKey}`, undefined, paused);
  const d = errors.data;
  return (
    <>
      <div className="ov-kpi-grid st-error-kpis msg-error-kpis">
        {KINDS.map((k) => (
          <div key={k} className={`ov-card ov-kpi ov-tone-${(d?.counts[k] ?? 0) > 0 ? 'warn' : 'ok'}`}>
            <span className="ov-kpi-label">{t(`messaging.errors.kind.${k}`)}</span>
            <span className="ov-kpi-value">{d ? d.counts[k] : NO_VALUE}</span>
          </div>
        ))}
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.errors.title')}</h3>
          <span className="ov-section-hint">{d ? t('messaging.errors.byStage', { publish: d.byStage.publish, consume: d.byStage.consume }) : ''}</span>
        </header>
        {d && d.items.length === 0 ? (
          <p className="ov-empty-line">{t('messaging.errors.empty', { range: t(`tr.range.${range}`) })}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('db.errors.time')}</th>
                  <th>{t('messaging.errors.component')}</th>
                  <th>{t('messaging.message.channel')}</th>
                  <th>{t('db.errors.type')}</th>
                  <th>{t('messaging.message.id')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d?.items.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td>{formatTime(Date.parse(e.at), true)}</td>
                    <td>
                      {e.consumer ?? (e.runtime ? t(`rt.name.${e.runtime}`) : NO_VALUE)}
                      <small className="pf-row-note">{t(`messaging.errors.stage.${e.stage}`)}</small>
                    </td>
                    <td className="cache-key-cell">
                      <code>{e.channel}</code>
                      <small className="pf-row-note">{e.message}</small>
                    </td>
                    <td>
                      <span className={`pf-chip ov-tone-${e.final ? 'crit' : 'warn'}`}>{t(`messaging.errors.kind.${e.kind}`)}</span>
                      {e.attempt !== null && (
                        <small className="pf-row-note">
                          {t('messaging.errors.attempt', { attempt: e.attempt, max: e.maxAttempts ?? '?' })}
                          {e.final && ` · ${t('messaging.errors.final')}`}
                        </small>
                      )}
                    </td>
                    <td>
                      {e.messageId ? (
                        <button type="button" className="ov-link" onClick={() => openMessage(e.messageId!, e.queue)}>
                          <code>{shortId(e.messageId)}</code>
                        </button>
                      ) : (
                        NO_VALUE
                      )}
                    </td>
                    <td>
                      {e.correlationId && (
                        <button
                          type="button"
                          className="ov-link"
                          onClick={() => navigate(`logs?runtime=${e.runtime ?? 'worker'}&correlationId=${encodeURIComponent(e.correlationId!)}`)}
                        >
                          <FileText size={12} /> {t('db.query.openLogs')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.events.title')}</h3>
        </header>
        <MessagingEventList events={events.data} onOpen={openEvent} emptyText={t('messaging.events.empty')} />
      </section>
    </>
  );
};

/** Lịch sử thao tác quản trị (audit): test broker, retry, replay, discard, xem payload. */
export const MessagingOperationsView: React.FC<{ paused: boolean; reloadKey: number }> = ({ paused, reloadKey }) => {
  const { t, formatTime } = useLocale();
  const { data } = usePolling(() => messagingApi.operations(), `ops:${reloadKey}`, undefined, paused);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('messaging.audit.title')}</h3>
        <span className="ov-section-hint">{t('messaging.audit.hint')}</span>
      </header>
      {data && data.length === 0 ? (
        <p className="ov-empty-line">{t('messaging.audit.empty')}</p>
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
              {data?.map((o) => (
                <tr key={o.id}>
                  <td>
                    {new Date(o.at).toLocaleDateString()} {formatTime(Date.parse(o.at), true)}
                  </td>
                  <td>
                    {o.actor ?? t('cache.ops.anonymous')}
                    {o.ip && <small className="pf-row-note">{o.ip}</small>}
                  </td>
                  <td className="cache-key-cell">
                    {t(`messaging.audit.kind.${o.action}`)} <code>{o.target}</code>
                    {o.detail && <small className="pf-row-note">{o.action === 'test' ? t(`messaging.test.step.${o.detail}`) : o.detail}</small>}
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
      <p className="pf-chart-note">{t('messaging.audit.note')}</p>
    </section>
  );
};

/** Cấu hình đang nạp (provider, delivery, retry, lưu giữ, ngưỡng, thao tác) — credential chỉ hiện "đã cấu hình". */
export const MessagingConfigView: React.FC = () => {
  const { t, locale } = useLocale();
  const { data } = usePolling(() => messagingApi.config(), 'messaging-config', 60_000);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!data) return;
    const safe = Object.fromEntries(data.items.filter((i) => !i.sensitive).map((i) => [i.key, i.value]));
    void navigator.clipboard?.writeText(JSON.stringify(safe, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const MS_KEYS = ['timeoutMs', 'backoffDelayMs', 'processingP95Ms'];
  const LABELLED = ['mode', 'acknowledgement', 'ordering', 'backoff'];
  const render = (item: NonNullable<typeof data>['items'][number]) => {
    if (item.sensitive) return item.value ? t('db.config.configured') : t('db.config.notConfigured');
    if (typeof item.value === 'boolean') return item.value ? t('db.config.yes') : t('db.config.no');
    if (item.value === null) return NO_VALUE;
    if (MS_KEYS.includes(item.key)) return formatDuration(Number(item.value));
    if (LABELLED.includes(item.key)) return t(`messaging.config.value.${item.key}.${item.value}`);
    if (typeof item.value === 'number') return formatCompact(item.value, locale);
    return String(item.value);
  };
  const groups = [...new Set(data?.items.map((i) => i.group) ?? [])];
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('messaging.config.title')}</h3>
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={copy} disabled={!data}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : t('db.config.copy')}
        </button>
      </header>
      {groups.map((g) => (
        <div key={g} className="cache-config-group">
          <h4>{t(`messaging.config.group.${g}`)}</h4>
          <div className="scp-table-wrap">
            <table className="scp-table tr-kv-table">
              <tbody>
                {data?.items
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <tr key={i.key}>
                      <th>{t(`messaging.config.key.${i.key}`)}</th>
                      <td>{i.sensitive ? <span className="pf-chip ov-tone-ok">{render(i)}</span> : <code>{render(i)}</code>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="pf-chart-note">{t('messaging.config.note')}</p>
    </section>
  );
};
