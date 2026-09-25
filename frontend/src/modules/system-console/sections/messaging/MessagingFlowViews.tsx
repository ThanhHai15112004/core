import React from 'react';
import { AlertOctagon, Search } from 'lucide-react';
import type { MessagingRange, MessagingTab } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { usePolling } from '../../hooks/usePolling';
import { ChannelTable } from '../../components/messaging/ChannelTable';
import { ConsumerTable } from '../../components/messaging/ConsumerTable';
import { QueueDepthTable } from '../../components/messaging/QueueDepthTable';
import { SectionState } from '../../components/database/SectionState';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatAge, formatMsgRate } from '../../utils/messaging-format';
import { formatUptime, NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

type Go = (tab: MessagingTab, id?: string | null, query?: Record<string, string | number | undefined>) => void;
interface ViewProps {
  range: MessagingRange;
  paused: boolean;
  reloadKey: number;
  product: string;
  go: Go;
}

/** Channel (topic) + độ sâu queue trên broker. Lag theo channel lấy từ mẫu message đang chờ (có giới hạn). */
export const MessagingChannelsView: React.FC<ViewProps> = ({ range, paused, reloadKey, product, go }) => {
  const { t, locale } = useLocale();
  const { data, error } = usePolling(() => messagingApi.channels(range), `channels:${range}:${reloadKey}`, 15_000, paused);
  return (
    <>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.channel.title')}</h3>
          {data?.backlogSampled !== null && data?.backlogSampled !== undefined && (
            <span className="ov-section-hint">
              {t('messaging.channel.backlogSample', { count: formatCompact(data.backlogSampled, locale) })}
              {data.backlogTruncated && ` · ${t('messaging.channel.backlogTruncated')}`}
            </span>
          )}
        </header>
        {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
        {data && <ChannelTable rows={data.channels} onOpen={(name) => go('channels', name)} emptyText={t('messaging.channel.empty')} />}
        <p className="pf-chart-note">{t('messaging.channel.note', { range: t(`tr.range.${range}`) })}</p>
      </section>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.queue.title')}</h3>
          <span className="ov-section-hint">{t('messaging.queue.hint')}</span>
        </header>
        <SectionState section={data?.queues} driver={product} scope="messaging">
          {(rows) => <QueueDepthTable rows={rows} />}
        </SectionState>
      </section>
    </>
  );
};

/** Ai đang publish: theo runtime (API, Worker, Scheduler, CLI), tốc độ, lỗi và channel. */
export const MessagingProducersView: React.FC<ViewProps> = ({ range, paused, reloadKey, go }) => {
  const { t, locale, formatRelative } = useLocale();
  const now = Date.now();
  const { data, error } = usePolling(() => messagingApi.producers(range), `producers:${range}:${reloadKey}`, 15_000, paused);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('messaging.producer.title')}</h3>
        <span className="ov-section-hint">{t('messaging.producer.hint')}</span>
      </header>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {data && data.producers.length === 0 && <p className="ov-empty-line">{t('messaging.producer.empty')}</p>}
      <div className="msg-producers">
        {data?.producers.map((p) => (
          <article key={p.producer} className="msg-producer">
            <header>
              <strong>{t(`rt.name.${p.producer}`)}</strong>
              <span className={`pf-chip ov-tone-${p.failures > 0 ? 'warn' : 'ok'}`}>
                {p.failures > 0 ? t('messaging.producer.failures', { count: p.failures }) : t('messaging.producer.noFailures')}
              </span>
            </header>
            <dl className="db-stat-grid db-stat-compact">
              <div>
                <dt>{t('messaging.producer.rate')}</dt>
                <dd>{formatMsgRate(p.perSec)}</dd>
              </div>
              <div>
                <dt>{t('messaging.producer.published')}</dt>
                <dd>{formatCompact(p.published, locale)}</dd>
              </div>
              <div>
                <dt>{t('messaging.channel.failureRate')}</dt>
                <dd>{formatUnit(p.failureRatePercent, '%')}</dd>
              </div>
              <div>
                <dt>{t('messaging.producer.lastPublished')}</dt>
                <dd>{p.lastPublishedAt ? formatRelative(new Date(p.lastPublishedAt), now) : NO_VALUE}</dd>
              </div>
              <div>
                <dt>{t('messaging.producer.lastFailure')}</dt>
                <dd>{p.lastFailureAt ? formatRelative(new Date(p.lastFailureAt), now) : NO_VALUE}</dd>
              </div>
            </dl>
            <div className="scp-table-wrap">
              <table className="scp-table">
                <thead>
                  <tr>
                    <th>{t('messaging.channel.name')}</th>
                    <th>{t('messaging.producer.rate')}</th>
                    <th>{t('messaging.producer.published')}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.channels.map((c) => (
                    <tr key={c.channel} className="is-clickable" onClick={() => go('channels', c.channel)}>
                      <td>
                        <code>{c.channel}</code>
                        <small className="pf-row-note">{t('messaging.channel.via', { queue: c.queue })}</small>
                      </td>
                      <td>{formatMsgRate(c.perSec)}</td>
                      <td>{formatCompact(c.published, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
      <p className="pf-chart-note">{t('messaging.producer.note', { range: t(`tr.range.${range}`) })}</p>
    </section>
  );
};

/** Consumer đang chạy + queue có message mà không ai tiêu thụ + tài nguyên broker. */
export const MessagingConsumersView: React.FC<ViewProps & { navigate: (p: string) => void }> = ({ range, paused, reloadKey, product, go, navigate }) => {
  const { t, locale } = useLocale();
  const { data, error } = usePolling(() => messagingApi.consumers(range), `consumers:${range}:${reloadKey}`, 15_000, paused);
  const broker = usePolling(() => messagingApi.broker(), `broker:${reloadKey}`, 30_000, paused);
  return (
    <>
      {data?.unconsumed.map((q) => (
        <section key={q.name} className="pf-status db-health ov-tone-crit" role="alert">
          <AlertOctagon size={20} className="pf-status-icon" />
          <div className="db-health-body">
            <strong>
              {t('messaging.consumer.noConsumerTitle')} · <code>{q.name}</code>
            </strong>
            <span className="db-health-meta">
              {t('messaging.consumer.noConsumerBody', { waiting: formatCompact(q.waiting, locale), oldest: formatAge(q.oldestWaitingSec) })}
            </span>
          </div>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate('runtimes/worker')}>
            <Search size={13} /> {t('messaging.consumer.inspectRuntime')}
          </button>
        </section>
      ))}
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.consumer.title')}</h3>
          <span className="ov-section-hint">{t('messaging.consumer.hint')}</span>
        </header>
        {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
        {data && <ConsumerTable rows={data.consumers} onOpen={(name) => go('consumers', name)} emptyText={t('messaging.consumer.empty')} />}
        <p className="pf-chart-note">{t('messaging.consumer.note')}</p>
      </section>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.broker.title')}</h3>
          <span className="ov-section-hint">{product}</span>
        </header>
        <SectionState section={broker.data?.broker} driver={product} scope="messaging">
          {(b) => (
            <dl className="db-stat-grid db-stat-compact">
              <div>
                <dt>{t('messaging.broker.version')}</dt>
                <dd>{b.version ?? NO_VALUE}</dd>
              </div>
              <div>
                <dt>{t('messaging.broker.uptime')}</dt>
                <dd>{formatUptime(b.uptimeSec)}</dd>
              </div>
              <div>
                <dt>{t('messaging.broker.memory')}</dt>
                <dd>
                  {formatBytes(b.usedMemoryBytes)}
                  {b.maxMemoryBytes && ` / ${formatBytes(b.maxMemoryBytes)}`}
                </dd>
              </div>
              <div>
                <dt>{t('messaging.broker.clients')}</dt>
                <dd>{b.connectedClients ?? NO_VALUE}</dd>
              </div>
              <div>
                <dt>{t('messaging.broker.connections')}</dt>
                <dd>{b.connections.length ? b.connections.map((c) => `${t(`rt.name.${c.runtime}`)} ${c.count}`).join(' · ') : NO_VALUE}</dd>
              </div>
            </dl>
          )}
        </SectionState>
        <p className="pf-chart-note">{t('messaging.broker.note')}</p>
      </section>
    </>
  );
};
