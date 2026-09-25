import React from 'react';
import { AlertTriangle, RotateCcw, Trash2, Zap } from 'lucide-react';
import type { MessageRow } from '../../types/messaging.types';
import type { ActionTarget, MessagingAction } from '../../hooks/useMessagingActions';
import { messagingApi } from '../../services/messaging.api';
import { usePolling } from '../../hooks/usePolling';
import { SectionState } from '../../components/database/SectionState';
import { MessageTable } from '../../components/messaging/MessageTable';
import { BarList } from '../../components/cache/TtlDistribution';
import { formatCompact, formatDuration } from '../../utils/database-format';
import { formatAge } from '../../utils/messaging-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  paused: boolean;
  reloadKey: number;
  product: string;
  now: number;
  onOpen: (m: MessageRow) => void;
  onAction: (action: MessagingAction, target: ActionTarget) => void;
}

/** Message đang chờ retry (lần kế tiếp, lỗi gần nhất) + thống kê hôm nay + chính sách retry. */
export const MessagingRetriesView: React.FC<Props> = ({ paused, reloadKey, product, now, onOpen, onAction }) => {
  const { t, locale } = useLocale();
  const { data, error } = usePolling(() => messagingApi.retries(), `retries:${reloadKey}`, 5000, paused);
  const s = data?.stats;
  const tiles = [
    { key: 'retryingNow', value: s?.retryingNow ?? null, tone: (s?.retryingNow ?? 0) > 0 ? 'warn' : 'ok' },
    { key: 'retriedToday', value: s?.retriedToday ?? null, tone: 'unknown' },
    { key: 'recoveredToday', value: s?.recoveredToday ?? null, tone: 'ok' },
    { key: 'deadLetteredToday', value: s?.deadLetteredToday ?? null, tone: (s?.deadLetteredToday ?? 0) > 0 ? 'warn' : 'ok' },
  ];
  const p = data?.policy;
  return (
    <>
      <div className="ov-kpi-grid msg-kpi-4">
        {tiles.map((x) => (
          <div key={x.key} className={`ov-card ov-kpi ov-tone-${x.tone}`}>
            <span className="ov-kpi-label">{t(`messaging.retries.${x.key}`)}</span>
            <span className="ov-kpi-value">{x.value === null ? NO_VALUE : formatCompact(x.value, locale)}</span>
          </div>
        ))}
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.retries.title')}</h3>
          <span className="ov-section-hint">{t('messaging.retries.hint')}</span>
        </header>
        {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
        <SectionState section={data?.retrying} driver={product} scope="messaging">
          {(rows) => (
            <MessageTable
              rows={rows}
              onOpen={onOpen}
              columns={['id', 'channel', 'attempts', 'next', 'error']}
              emptyText={t('messaging.retries.empty')}
              now={now}
              actions={
                data?.retryEnabled
                  ? (m) => (
                      <button type="button" className="ov-link" onClick={() => onAction('retry', m)}>
                        <Zap size={12} /> {t('messaging.action.retry')}
                      </button>
                    )
                  : undefined
              }
            />
          )}
        </SectionState>
      </section>
      {p && (
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('messaging.retries.policy')}</h3>
            <span className="ov-section-hint">{t('messaging.retries.policyHint')}</span>
          </header>
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('messaging.retries.maxAttempts')}</dt>
              <dd>{p.maxAttempts}</dd>
            </div>
            <div>
              <dt>{t('messaging.retries.strategy')}</dt>
              <dd>{t(`messaging.retries.backoff.${p.backoff}`)}</dd>
            </div>
            <div>
              <dt>{t('messaging.retries.initialDelay')}</dt>
              <dd>{formatDuration(p.initialDelayMs)}</dd>
            </div>
            <div>
              <dt>{t('messaging.retries.maxDelay')}</dt>
              <dd>{formatDuration(p.maxDelayMs)}</dd>
            </div>
          </dl>
        </section>
      )}
    </>
  );
};

/** Dead Letter: số lượng, thêm hôm nay, cũ nhất, nguồn lớn nhất, bảng message → Replay / Discard. */
export const MessagingDeadLetterView: React.FC<Props> = ({ paused, reloadKey, product, now, onOpen, onAction }) => {
  const { t, locale } = useLocale();
  const { data, error } = usePolling(() => messagingApi.deadLetter(), `dlq:${reloadKey}`, 10_000, paused);
  const s = data?.settings;
  const top = data?.bySource[0];
  return (
    <>
      <div className="ov-kpi-grid msg-kpi-4">
        <div className={`ov-card ov-kpi ov-tone-${(data?.total ?? 0) > 0 ? 'warn' : 'ok'}`}>
          <span className="ov-kpi-label">{t('messaging.deadLetter.total')}</span>
          <span className="ov-kpi-value">{data?.total === null || !data ? NO_VALUE : formatCompact(data.total, locale)}</span>
        </div>
        <div className="ov-card ov-kpi ov-tone-unknown">
          <span className="ov-kpi-label">{t('messaging.deadLetter.addedToday')}</span>
          <span className="ov-kpi-value">{data ? formatCompact(data.addedToday, locale) : NO_VALUE}</span>
        </div>
        <div className="ov-card ov-kpi ov-tone-unknown">
          <span className="ov-kpi-label">{t('messaging.deadLetter.oldest')}</span>
          <span className="ov-kpi-value">{formatAge(data?.oldestSec)}</span>
        </div>
        <div className="ov-card ov-kpi ov-tone-unknown">
          <span className="ov-kpi-label">{t('messaging.deadLetter.largestSource')}</span>
          <span className="ov-kpi-value msg-kpi-text">{top ? top.channel : NO_VALUE}</span>
          {top && <span className="ov-kpi-sub">{t('messaging.deadLetter.sourceCount', { count: top.count })}</span>}
        </div>
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.deadLetter.title')}</h3>
          <span className="ov-section-hint">{t('messaging.deadLetter.hint')}</span>
        </header>
        <p className="msg-idempotency ov-tone-warn">
          <AlertTriangle size={13} /> {t('messaging.deadLetter.idempotencyWarning')}
        </p>
        {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
        <SectionState section={data?.items} driver={product} scope="messaging">
          {(rows) => (
            <MessageTable
              rows={rows}
              onOpen={onOpen}
              columns={['time', 'id', 'channel', 'attempts', 'error']}
              emptyText={t('messaging.deadLetter.empty')}
              now={now}
              actions={
                s && (s.replay || s.discard)
                  ? (m) => (
                      <span className="msg-row-actions">
                        {s.replay && (
                          <button type="button" className="ov-link" onClick={() => onAction('replay', m)}>
                            <RotateCcw size={12} /> {t('messaging.action.replay')}
                          </button>
                        )}
                        {s.discard && (
                          <button type="button" className="ov-link is-danger" onClick={() => onAction('discard', m)}>
                            <Trash2 size={12} /> {t('messaging.action.discard')}
                          </button>
                        )}
                      </span>
                    )
                  : undefined
              }
            />
          )}
        </SectionState>
      </section>
      {data && data.bySource.length > 0 && (
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('messaging.deadLetter.bySource')}</h3>
          </header>
          <BarList items={data.bySource.map((b) => ({ id: b.channel, label: <code>{b.channel}</code>, value: b.count, text: formatCompact(b.count, locale) }))} />
        </section>
      )}
    </>
  );
};
