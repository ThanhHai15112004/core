import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, Eye, EyeOff, FileText, RotateCcw, ShieldCheck, Trash2, Zap } from 'lucide-react';
import type { LifecycleEntry, MessageDetail, MessagePayload } from '../../types/messaging.types';
import type { ActionTarget, MessagingAction } from '../../hooks/useMessagingActions';
import { messagingApi } from '../../services/messaging.api';
import { usePolling } from '../../hooks/usePolling';
import { MESSAGE_STATUS_TONE } from '../../constants/messaging';
import { DbDrawer } from '../database/DbDrawer';
import { formatBytes, formatDuration } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const STEP_TONE: Record<LifecycleEntry['type'], string> = {
  published: 'unknown',
  received: 'unknown',
  completed: 'ok',
  failed: 'crit',
  retry_scheduled: 'warn',
  dead_lettered: 'crit',
  retried_manually: 'warn',
  replayed: 'warn',
};

/**
 * Chi tiết message: metadata, vòng đời (publish → nhận → lỗi → retry → dead letter…), lỗi & stack,
 * correlation ID → log, payload (đã che, chỉ tải khi bấm), Retry / Replay / Discard theo trạng thái và env.
 */
export const MessageDrawer: React.FC<{
  messageId: string;
  queue?: string;
  reloadKey: number;
  now: number;
  onClose: () => void;
  onAction: (action: MessagingAction, target: ActionTarget) => void;
  onOpenChannel: (channel: string) => void;
  onOpenConsumer: (consumer: string) => void;
  navigate: (path: string) => void;
}> = ({ messageId, queue, reloadKey, now, onClose, onAction, onOpenChannel, onOpenConsumer, navigate }) => {
  const { t, formatTime, formatRelative } = useLocale();
  const { data, error } = usePolling(() => messagingApi.message(messageId, queue), `${messageId}:${queue ?? ''}:${reloadKey}`, 10_000);
  const [copied, setCopied] = useState<string | null>(null);
  const [payload, setPayload] = useState<MessagePayload | null>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [loadingPayload, setLoadingPayload] = useState(false);

  const copy = (text: string, id: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };
  const stamp = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString()} ${formatTime(Date.parse(iso), true)}` : NO_VALUE);
  const loadPayload = async (d: MessageDetail) => {
    if (payload) return setPayload(null);
    setLoadingPayload(true);
    setPayloadError(null);
    try {
      setPayload(await messagingApi.payload(d.id, d.queue));
    } catch (err) {
      setPayloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPayload(false);
    }
  };
  const logsRuntime = (d: MessageDetail) => [...d.lifecycle].reverse().find((e) => e.type !== 'published' && e.runtime)?.runtime ?? d.producer ?? 'api';

  return (
    <DbDrawer
      title={<code className="cache-key-title">{messageId}</code>}
      meta={data ? `${data.channel} · ${t(`messaging.status.${data.status}`)}` : t('messaging.message.drawerMeta')}
      onClose={onClose}
    >
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {data && (
        <>
          <dl className="db-stat-grid">
            <div>
              <dt>{t('messaging.channel.status')}</dt>
              <dd>
                <span className={`pf-chip ov-tone-${MESSAGE_STATUS_TONE[data.status]}`}>{t(`messaging.status.${data.status}`)}</span>
              </dd>
            </div>
            <div>
              <dt>{t('messaging.message.channel')}</dt>
              <dd>
                <button type="button" className="ov-link" onClick={() => onOpenChannel(data.channel)}>
                  <code>{data.channel}</code>
                </button>
              </dd>
            </div>
            <div>
              <dt>{t('messaging.message.queue')}</dt>
              <dd>
                <code>{data.queue}</code>
              </dd>
            </div>
            <div>
              <dt>{t('messaging.message.producer')}</dt>
              <dd>{data.producer ? t(`rt.name.${data.producer}`) : NO_VALUE}</dd>
            </div>
            <div>
              <dt>{t('messaging.message.consumer')}</dt>
              <dd>
                {data.consumers.length
                  ? data.consumers.map((c) => (
                      <button key={c} type="button" className="ov-link" onClick={() => onOpenConsumer(c)}>
                        <code>{c}</code>
                      </button>
                    ))
                  : NO_VALUE}
              </dd>
            </div>
            <div>
              <dt>{t('messaging.message.published')}</dt>
              <dd>{stamp(data.publishedAt)}</dd>
            </div>
            <div>
              <dt>{t('messaging.message.attempts')}</dt>
              <dd className={data.attempts > 1 ? 'is-warn' : ''}>
                {data.attempts} / {data.maxAttempts}
              </dd>
            </div>
            <div>
              <dt>{t('messaging.message.duration')}</dt>
              <dd>{data.durationMs === null ? NO_VALUE : formatDuration(data.durationMs)}</dd>
            </div>
            <div>
              <dt>{t('messaging.message.wait')}</dt>
              <dd>{data.waitMs === null ? NO_VALUE : formatDuration(data.waitMs)}</dd>
            </div>
            <div>
              <dt>{t('messaging.message.size')}</dt>
              <dd className={data.large ? 'is-warn' : ''}>{formatBytes(data.size)}</dd>
            </div>
            {data.nextAttemptAt && (
              <div>
                <dt>{t('messaging.message.nextAttempt')}</dt>
                <dd>{formatRelative(new Date(data.nextAttemptAt), now)}</dd>
              </div>
            )}
            <div>
              <dt>{t('messaging.message.correlationId')}</dt>
              <dd>{data.correlationId ? <code>{data.correlationId}</code> : NO_VALUE}</dd>
            </div>
          </dl>
          {data.malformed && (
            <p className="scp-alert-warning">
              <AlertTriangle size={13} /> {t('messaging.message.malformed')}
            </p>
          )}
          {data.large && <p className="scp-alert-warning">{t('messaging.message.largeWarning', { size: formatBytes(data.size) })}</p>}

          <div className="cache-drawer-actions">
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => copy(data.id, 'id')}>
              {copied === 'id' ? <Check size={13} /> : <Copy size={13} />} {copied === 'id' ? t('console.drawer.copied') : t('messaging.message.copyId')}
            </button>
            {data.correlationId && (
              <button
                type="button"
                className="scp-btn scp-btn-sm scp-btn-secondary"
                onClick={() => navigate(`logs?runtime=${logsRuntime(data)}&correlationId=${encodeURIComponent(data.correlationId!)}`)}
              >
                <FileText size={13} /> {t('messaging.message.openLogs')}
              </button>
            )}
            {data.status === 'retrying' && data.settings.retry && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onAction('retry', data)}>
                <Zap size={13} /> {t('messaging.action.retry')}
              </button>
            )}
            {data.status === 'dead_letter' && data.settings.replay && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onAction('replay', data)}>
                <RotateCcw size={13} /> {t('messaging.action.replay')}
              </button>
            )}
            {data.status === 'dead_letter' && data.settings.discard && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-danger" onClick={() => onAction('discard', data)}>
                <Trash2 size={13} /> {t('messaging.action.discard')}
              </button>
            )}
          </div>
          {(data.status === 'dead_letter' || data.status === 'retrying') && (
            <p className={`msg-idempotency ov-tone-${data.idempotent === true ? 'ok' : 'warn'}`}>
              {data.idempotent === true ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}{' '}
              {t(`messaging.idempotent.hint.${data.idempotent === true ? 'yes' : data.idempotent === false ? 'no' : 'unknown'}`)}
            </p>
          )}

          <h4>{t('messaging.lifecycle.title')}</h4>
          <ol className="msg-timeline">
            {data.lifecycle.map((e, i) => {
              const prev = data.lifecycle[i - 1];
              const gap = prev ? Date.parse(e.at) - Date.parse(prev.at) : null;
              return (
                <li key={`${e.at}-${e.type}-${i}`} className={`ov-tone-${STEP_TONE[e.type]}`}>
                  {gap !== null && gap >= 0 && <span className="msg-timeline-gap">↓ {formatDuration(gap)}</span>}
                  <span className="ov-dot" aria-hidden="true" />
                  <div>
                    <time dateTime={e.at}>{formatTime(Date.parse(e.at), true)}</time>
                    <strong>
                      {t(`messaging.lifecycle.${e.type}`, {
                        runtime: e.runtime ? t(`rt.name.${e.runtime}`) : '?',
                        consumer: e.consumer ?? '?',
                        attempt: e.attempt ?? '',
                        delay: e.delayMs === null ? '' : formatDuration(e.delayMs),
                      })}
                    </strong>
                    {e.ms !== null && <small>{formatDuration(e.ms)}</small>}
                    {e.error && <small className="msg-timeline-error">{e.error}</small>}
                  </div>
                </li>
              );
            })}
          </ol>
          {data.lifecycle.length <= 1 && <p className="pf-chart-note">{t('messaging.lifecycle.onlyPublished')}</p>}

          {data.error && (
            <>
              <h4>{t('messaging.message.lastError')}</h4>
              <p className="scp-alert scp-alert-danger">{data.error}</p>
              {data.stacktrace.length > 0 && (
                <details className="msg-stack">
                  <summary>{t('messaging.message.stacktrace', { count: data.stacktrace.length })}</summary>
                  <pre>{data.stacktrace.at(-1)}</pre>
                </details>
              )}
            </>
          )}

          <h4>{t('messaging.message.metadata')}</h4>
          <div className="scp-table-wrap">
            <table className="scp-table tr-kv-table">
              <tbody>
                <tr>
                  <th>{t('messaging.message.id')}</th>
                  <td>
                    <code>{data.id}</code>
                  </td>
                </tr>
                <tr>
                  <th>{t('messaging.message.key')}</th>
                  <td>
                    <code>{data.channel}</code>
                  </td>
                </tr>
                <tr>
                  <th>{t('messaging.message.contentType')}</th>
                  <td>application/json</td>
                </tr>
                <tr>
                  <th>{t('messaging.message.retryPolicy')}</th>
                  <td>
                    {data.backoff
                      ? t('messaging.message.backoff', { type: data.backoff.type, delay: formatDuration(data.backoff.delayMs), max: data.maxAttempts })
                      : t('messaging.message.noRetry', { max: data.maxAttempts })}
                  </td>
                </tr>
                <tr>
                  <th>{t('messaging.message.processed')}</th>
                  <td>{stamp(data.processedAt)}</td>
                </tr>
                <tr>
                  <th>{t('messaging.message.finished')}</th>
                  <td>{stamp(data.finishedAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h4>{t('messaging.payload.title')}</h4>
          {data.settings.payload ? (
            <>
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" disabled={loadingPayload} onClick={() => void loadPayload(data)}>
                {payload ? <EyeOff size={13} /> : <Eye size={13} />} {payload ? t('messaging.payload.hide') : t('messaging.payload.show')}
              </button>
              {payloadError && <p className="scp-alert scp-alert-danger">{payloadError}</p>}
              {payload && (
                <>
                  <pre className="msg-payload">{JSON.stringify(payload.payload, null, 2)}</pre>
                  <p className="pf-chart-note">{t(payload.redacted ? 'messaging.payload.redacted' : 'messaging.payload.note')}</p>
                </>
              )}
            </>
          ) : (
            <p className="pf-chart-note">{t('messaging.payload.disabled')}</p>
          )}
        </>
      )}
    </DbDrawer>
  );
};
