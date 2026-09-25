import React from 'react';
import { Search } from 'lucide-react';
import type { MessageRow, MessagingRange } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { usePolling } from '../../hooks/usePolling';
import { CHANNEL_STATUS_TONE } from '../../constants/messaging';
import { DbDrawer } from '../database/DbDrawer';
import { LineChart } from '../common/LineChart';
import { SectionState } from '../database/SectionState';
import { ConsumerTable } from './ConsumerTable';
import { MessageTable } from './MessageTable';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatAge, formatMsgRate, toMessagingChart } from '../../utils/messaging-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Chi tiết channel: publish/consume, lag, lỗi, thời gian xử lý, consumer, lỗi & message gần đây. */
export const ChannelDrawer: React.FC<{
  name: string;
  range: MessagingRange;
  now: number;
  onClose: () => void;
  onBrowse: (channel: string) => void;
  onOpenConsumer: (consumer: string) => void;
  onOpenMessage: (m: MessageRow) => void;
}> = ({ name, range, now, onClose, onBrowse, onOpenConsumer, onOpenMessage }) => {
  const { t, locale, formatTime } = useLocale();
  const { data, error } = usePolling(() => messagingApi.channel(name, range), `${name}:${range}`, 15_000);
  const c = data?.channel;
  const throughput = data ? toMessagingChart(data.throughput) : null;
  const processing = data ? toMessagingChart(data.processing) : null;
  return (
    <DbDrawer title={<code>{name}</code>} meta={c?.queue ? t('messaging.channel.via', { queue: c.queue }) : t('messaging.channel.drawerMeta')} onClose={onClose}>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {c && data && (
        <>
          <p className={`msg-status-line ov-tone-${CHANNEL_STATUS_TONE[c.status]}`}>
            <span className={`pf-chip ov-tone-${CHANNEL_STATUS_TONE[c.status]}`}>{t(`messaging.channel.statusOf.${c.status}`)}</span>
            <span>{t(`messaging.channel.statusHint.${c.status}`)}</span>
          </p>
          <dl className="db-stat-grid">
            <div>
              <dt>{t('messaging.channel.publish')}</dt>
              <dd>{formatMsgRate(c.publishPerSec)}</dd>
            </div>
            <div>
              <dt>{t('messaging.channel.consume')}</dt>
              <dd>{formatMsgRate(c.consumePerSec)}</dd>
            </div>
            <div>
              <dt>{t('messaging.channel.lag')}</dt>
              <dd className={(c.lag ?? 0) > 0 ? 'is-warn' : ''}>{c.lag === null ? NO_VALUE : formatCompact(c.lag, locale)}</dd>
            </div>
            <div>
              <dt>{t('messaging.channel.oldest')}</dt>
              <dd>{formatAge(c.oldestWaitingSec)}</dd>
            </div>
            <div>
              <dt>{t('messaging.channel.failureRate')}</dt>
              <dd className={c.failed > 0 ? 'is-warn' : ''}>{formatUnit(c.failureRatePercent, '%')}</dd>
            </div>
            <div>
              <dt>{t('messaging.channel.retries')}</dt>
              <dd>
                {c.retried} · DLQ {c.deadLettered}
              </dd>
            </div>
            <div>
              <dt>{t('messaging.processing.avg')}</dt>
              <dd>{formatUnit(c.avgMs, 'ms')}</dd>
            </div>
            <div>
              <dt>P95</dt>
              <dd>{formatUnit(c.p95Ms, 'ms')}</dd>
            </div>
            <div>
              <dt>{t('messaging.payload.avg')}</dt>
              <dd>{c.avgSizeBytes === null ? NO_VALUE : formatBytes(c.avgSizeBytes)}</dd>
            </div>
            <div>
              <dt>{t('messaging.channel.producers')}</dt>
              <dd>{c.producers.length ? c.producers.map((p) => t(`rt.name.${p}`)).join(', ') : NO_VALUE}</dd>
            </div>
          </dl>
          <div className="cache-drawer-actions">
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onBrowse(name)}>
              <Search size={13} /> {t('messaging.channel.browse')}
            </button>
          </div>
          {throughput && (
            <div className="cache-mini-chart">
              <h4>{t('messaging.chart.metric.throughput')}</h4>
              <LineChart
                series={throughput.series}
                unit={throughput.unit}
                height={140}
                formatTime={(ts) => formatTime(ts, range === '15m')}
                emptyText={t('messaging.chart.empty')}
                ariaLabel={t('messaging.chart.metric.throughput')}
              />
            </div>
          )}
          {processing && (
            <div className="cache-mini-chart">
              <h4>{t('messaging.chart.metric.processing')}</h4>
              <LineChart
                series={processing.series}
                unit={processing.unit}
                height={140}
                formatTime={(ts) => formatTime(ts, range === '15m')}
                emptyText={t('messaging.chart.empty')}
                ariaLabel={t('messaging.chart.metric.processing')}
              />
            </div>
          )}
          <h4>{t('messaging.consumer.title')}</h4>
          <ConsumerTable rows={data.consumers} onOpen={onOpenConsumer} emptyText={t('messaging.channel.noConsumer')} />
          <h4>{t('messaging.errors.recent')}</h4>
          {data.recentErrors.length === 0 ? (
            <p className="cache-ok-line">{t('messaging.errors.noneHere')}</p>
          ) : (
            <ul className="cache-key-list">
              {data.recentErrors.map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <span>
                    {formatTime(Date.parse(e.at), true)} · {e.message}
                  </span>
                  <span className="is-warn">{t(`messaging.errors.kind.${e.kind}`)}</span>
                </li>
              ))}
            </ul>
          )}
          <h4>{t('messaging.message.recent')}</h4>
          <SectionState section={data.recentMessages} scope="messaging">
            {(rows) => <MessageTable rows={rows} onOpen={onOpenMessage} columns={['time', 'id', 'status', 'duration']} emptyText={t('messaging.message.none')} now={now} />}
          </SectionState>
        </>
      )}
    </DbDrawer>
  );
};
