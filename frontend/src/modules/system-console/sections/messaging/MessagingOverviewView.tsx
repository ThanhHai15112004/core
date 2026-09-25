import React from 'react';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import type { MessageRow, MessagingEvent, MessagingOverview, MessagingReport, MessagingTab } from '../../types/messaging.types';
import { MessagingKpis } from '../../components/messaging/MessagingKpis';
import { MessagingChart } from '../../components/messaging/MessagingChart';
import { MessagingAlerts } from '../../components/messaging/MessagingAlerts';
import { MessagingEventList } from '../../components/messaging/MessagingEventList';
import { ChannelTable } from '../../components/messaging/ChannelTable';
import { ConsumerTable } from '../../components/messaging/ConsumerTable';
import { QueueDepthTable } from '../../components/messaging/QueueDepthTable';
import { SectionState } from '../../components/database/SectionState';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatUnit, trendOf } from '../../utils/performance-format';
import { formatMsgRate, shortId } from '../../utils/messaging-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  data: MessagingOverview | null;
  now: number;
  paused: boolean;
  go: (tab: MessagingTab, id?: string | null, query?: Record<string, string | number | undefined>) => void;
  openEvent: (e: MessagingEvent) => void;
  openMessage: (m: MessageRow) => void;
}

const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / b) * 100);

/**
 * Tổng quan: KPI → throughput → cân bằng publish/consume + lag + vấn đề → channel → consumer + độ sâu queue →
 * dead letter + xử lý/kích thước → báo cáo hôm nay/hôm qua → sự kiện.
 */
export const MessagingOverviewView: React.FC<Props> = ({ data, now, paused, go, openEvent, openMessage }) => {
  const { t, locale } = useLocale();
  if (!data) return <MessagingKpis data={null} />;
  const n = (v: number | null) => (v === null ? NO_VALUE : formatCompact(v, locale));
  const reportRow = (key: keyof MessagingReport, fmt: (v: number | null) => string, higherIsWorse: boolean | null) => {
    const today = data.report.today[key];
    const yesterday = data.report.yesterday[key];
    const trend = trendOf(pct(today, yesterday), higherIsWorse);
    return (
      <tr key={key}>
        <th>{t(`messaging.report.${key}`)}</th>
        <td>{fmt(today)}</td>
        <td>{fmt(yesterday)}</td>
        <td>{trend ? <span className={`ov-kpi-trend is-${trend.tone}`}>{trend.text}</span> : NO_VALUE}</td>
      </tr>
    );
  };
  const b = data.balance;
  const lag = data.lagTrend;
  const LagIcon = lag.direction === 'down' ? TrendingDown : TrendingUp;
  return (
    <>
      <MessagingKpis data={data} />
      <MessagingChart range={data.range} paused={paused} />

      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('messaging.balance.title')}</h3>
            <span className="ov-section-hint">{t(`tr.range.${data.range}`)}</span>
          </header>
          <dl className="db-stat-grid msg-balance">
            <div>
              <dt>{t('messaging.kpi.published')}</dt>
              <dd>{formatMsgRate(b.publishedPerSec)}</dd>
            </div>
            <div>
              <dt>{t('messaging.kpi.consumed')}</dt>
              <dd>{formatMsgRate(b.consumedPerSec)}</dd>
            </div>
            <div>
              <dt>{t('messaging.balance.diff')}</dt>
              <dd className={b.state === 'growing' ? 'is-warn' : ''}>
                {b.diffPerSec === null ? NO_VALUE : `${b.diffPerSec > 0 ? '+' : ''}${formatMsgRate(b.diffPerSec)}`}
              </dd>
            </div>
          </dl>
          {b.state && (
            <p className={`msg-status-line ov-tone-${b.state === 'growing' ? 'warn' : 'ok'}`}>
              {t(`messaging.balance.state.${b.state}`, { perHour: n(b.growthPerHour) })}
            </p>
          )}
          <h4>{t('messaging.lagTrend.title')}</h4>
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('messaging.lagTrend.current')}</dt>
              <dd>{n(lag.current)}</dd>
            </div>
            <div>
              <dt>{t('messaging.lagTrend.ago')}</dt>
              <dd>{n(lag.ago15m)}</dd>
            </div>
            <div>
              <dt>{t('messaging.lagTrend.change')}</dt>
              <dd className={lag.direction === 'up' && (lag.current ?? 0) > 0 ? 'is-warn' : ''}>
                {lag.changePercent === null ? NO_VALUE : `${lag.changePercent > 0 ? '+' : ''}${formatUnit(lag.changePercent, '%')}`}
              </dd>
            </div>
          </dl>
          {lag.direction && lag.direction !== 'flat' && (lag.current ?? 0) + (lag.ago15m ?? 0) > 0 && (
            <p className={`msg-status-line ov-tone-${lag.direction === 'up' ? 'warn' : 'ok'}`}>
              <LagIcon size={14} /> {t(`messaging.lagTrend.${lag.direction}`)}
            </p>
          )}
        </section>
        <MessagingAlerts data={data} now={now} onOpen={(tab) => go(tab)} />
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.channel.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('channels')}>
            {t('messaging.channel.viewAll')} <ArrowRight size={13} />
          </button>
        </header>
        <ChannelTable rows={data.topChannels} sortable={false} onOpen={(name) => go('channels', name)} emptyText={t('messaging.channel.empty')} />
      </section>

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('messaging.consumer.title')}</h3>
            <button type="button" className="ov-link" onClick={() => go('consumers')}>
              {t('messaging.consumer.viewAll')} <ArrowRight size={13} />
            </button>
          </header>
          <ConsumerTable rows={data.consumers} onOpen={(name) => go('consumers', name)} emptyText={t('messaging.consumer.empty')} />
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('messaging.queue.title')}</h3>
            <span className="ov-section-hint">{data.provider.broker}</span>
          </header>
          <SectionState section={data.queues} driver={data.provider.product} scope="messaging">
            {(rows) => <QueueDepthTable rows={rows} />}
          </SectionState>
        </section>
      </div>

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('messaging.deadLetter.title')}</h3>
            <button type="button" className="ov-link" onClick={() => go('dead-letter')}>
              {t('messaging.deadLetter.open')} <ArrowRight size={13} />
            </button>
          </header>
          <SectionState section={data.deadLetter} driver={data.provider.product} scope="messaging">
            {(dl) => (
              <>
                <p className="db-pool-big">{t('messaging.deadLetter.count', { count: formatCompact(dl.total, locale) })}</p>
                {dl.latest.length === 0 ? (
                  <p className="cache-ok-line">{t('messaging.deadLetter.empty')}</p>
                ) : (
                  <ul className="cache-key-list">
                    {dl.latest.map((m) => (
                      <li key={m.id}>
                        <button type="button" className="ov-link" onClick={() => openMessage(m)}>
                          <code>{m.channel}</code> · <code>{shortId(m.id)}</code>
                        </button>
                        <span className="is-warn">{m.error ?? NO_VALUE}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </SectionState>
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('messaging.processing.title')}</h3>
          </header>
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('messaging.processing.avg')}</dt>
              <dd>{formatUnit(data.processing.avgMs, 'ms')}</dd>
            </div>
            <div>
              <dt>P95</dt>
              <dd>{formatUnit(data.processing.p95Ms, 'ms')}</dd>
            </div>
            <div>
              <dt>P99</dt>
              <dd>{formatUnit(data.processing.p99Ms, 'ms')}</dd>
            </div>
            <div>
              <dt>{t('messaging.payload.avg')}</dt>
              <dd>{data.payload.avgBytes === null ? NO_VALUE : formatBytes(data.payload.avgBytes)}</dd>
            </div>
            <div>
              <dt>{t('messaging.payload.max')}</dt>
              <dd className={(data.payload.maxBytes ?? 0) >= data.payload.largeBytes ? 'is-warn' : ''}>
                {data.payload.maxBytes === null ? NO_VALUE : formatBytes(data.payload.maxBytes)}
              </dd>
            </div>
            <div>
              <dt>{t('messaging.delivery.recovered')}</dt>
              <dd>{t('messaging.delivery.recoveredOf', { recovered: data.delivery.recovered, retried: data.delivery.retried })}</dd>
            </div>
          </dl>
          <p className="pf-chart-note">{t('messaging.processing.note', { size: formatBytes(data.payload.largeBytes) })}</p>
        </section>
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.report.title')}</h3>
          <span className="ov-section-hint">{t('db.report.hint')}</span>
        </header>
        <div className="scp-table-wrap">
          <table className="scp-table tr-kv-table db-report">
            <thead>
              <tr>
                <th />
                <th>{t('db.report.today')}</th>
                <th>{t('db.report.yesterday')}</th>
                <th>{t('db.report.change')}</th>
              </tr>
            </thead>
            <tbody>
              {reportRow('published', n, null)}
              {reportRow('consumed', n, null)}
              {reportRow('failed', n, true)}
              {reportRow('retried', n, true)}
              {reportRow('deadLettered', n, true)}
              {reportRow('avgProcessingMs', (v) => formatUnit(v, 'ms'), true)}
              {reportRow('avgLag', n, true)}
              {reportRow('peakLag', n, true)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('messaging.events.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('errors')}>
            {t('db.events.viewAll')} <ArrowRight size={13} />
          </button>
        </header>
        <MessagingEventList events={data.events} onOpen={openEvent} emptyText={t('messaging.events.empty')} />
      </section>
    </>
  );
};
