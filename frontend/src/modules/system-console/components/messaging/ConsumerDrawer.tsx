import React from 'react';
import { Activity, Cpu } from 'lucide-react';
import type { MessageRow, MessagingRange } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { usePolling } from '../../hooks/usePolling';
import { CONSUMER_STATUS_TONE } from '../../constants/messaging';
import { DbDrawer } from '../database/DbDrawer';
import { LineChart } from '../common/LineChart';
import { SectionState } from '../database/SectionState';
import { MessageTable } from './MessageTable';
import { formatCompact } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatMsgRate, toMessagingChart } from '../../utils/messaging-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Chi tiết consumer: trạng thái, instance, tốc độ, lag, avg/P95/P99, retry, lỗi, message gần đây; → Runtime/Performance. */
export const ConsumerDrawer: React.FC<{
  name: string;
  range: MessagingRange;
  now: number;
  onClose: () => void;
  onOpenMessage: (m: MessageRow) => void;
  navigate: (path: string) => void;
}> = ({ name, range, now, onClose, onOpenMessage, navigate }) => {
  const { t, locale, formatTime, formatRelative } = useLocale();
  const { data, error } = usePolling(() => messagingApi.consumer(name, range), `${name}:${range}`, 15_000);
  const c = data?.consumer;
  const charts = data
    ? [
        { key: 'processing', chart: toMessagingChart(data.processing) },
        { key: 'throughput', chart: toMessagingChart(data.throughput) },
        { key: 'lag', chart: toMessagingChart(data.lag) },
      ]
    : [];
  return (
    <DbDrawer title={<code>{name}</code>} meta={c ? `${c.queue}${c.runtime ? ` · ${t(`rt.name.${c.runtime}`)}` : ''}` : t('messaging.consumer.drawerMeta')} onClose={onClose}>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {c && data && (
        <>
          <p className={`msg-status-line ov-tone-${CONSUMER_STATUS_TONE[c.status]}`}>
            <span className={`pf-chip ov-tone-${CONSUMER_STATUS_TONE[c.status]}`}>{t(`messaging.consumer.statusOf.${c.status}`)}</span>
            <span>{t(`messaging.consumer.statusHint.${c.status}`)}</span>
          </p>
          <dl className="db-stat-grid">
            <div>
              <dt>{t('messaging.consumer.instances')}</dt>
              <dd>
                {c.instances.length}
                {c.brokerWorkers !== null && <small className="pf-row-note">{t('messaging.consumer.brokerWorkers', { n: c.brokerWorkers })}</small>}
              </dd>
            </div>
            <div>
              <dt>{t('messaging.consumer.rate')}</dt>
              <dd>{formatMsgRate(c.perSec)}</dd>
            </div>
            <div>
              <dt>{t('messaging.consumer.lag')}</dt>
              <dd className={(c.lag ?? 0) > 0 ? 'is-warn' : ''}>{c.lag === null ? NO_VALUE : formatCompact(c.lag, locale)}</dd>
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
              <dt>P99</dt>
              <dd>{formatUnit(c.p99Ms, 'ms')}</dd>
            </div>
            <div>
              <dt>{t('messaging.channel.failureRate')}</dt>
              <dd className={c.failed > 0 ? 'is-warn' : ''}>{formatUnit(c.failureRatePercent, '%')}</dd>
            </div>
            <div>
              <dt>{t('messaging.consumer.retry')}</dt>
              <dd>{t('messaging.consumer.retrySummary', { retried: data.retry.retried, recovered: data.retry.recovered, dlq: data.retry.deadLettered })}</dd>
            </div>
            <div>
              <dt>{t('messaging.message.idempotency')}</dt>
              <dd>
                <span className={`pf-chip ov-tone-${c.idempotent === true ? 'ok' : 'warn'}`}>
                  {t(`messaging.idempotent.${c.idempotent === true ? 'yes' : c.idempotent === false ? 'no' : 'unknown'}`)}
                </span>
              </dd>
            </div>
          </dl>
          <div className="cache-drawer-actions">
            {c.runtime && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(`runtimes/${c.runtime}`)}>
                <Cpu size={13} /> {t('messaging.consumer.inspectRuntime')}
              </button>
            )}
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate('performance')}>
              <Activity size={13} /> {t('messaging.consumer.openPerformance')}
            </button>
          </div>
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('messaging.consumer.instance')}</th>
                  <th>{t('messaging.consumer.concurrencyCol')}</th>
                  <th>{t('messaging.consumer.inFlight')}</th>
                  <th>{t('messaging.consumer.started')}</th>
                </tr>
              </thead>
              <tbody>
                {c.instances.map((i) => (
                  <tr key={i.instance}>
                    <td>
                      <code>{i.instance}</code>
                      {i.paused && <small className="pf-row-note">{t('messaging.consumer.statusOf.paused')}</small>}
                    </td>
                    <td>{i.concurrency}</td>
                    <td>{i.inFlight}</td>
                    <td>{formatRelative(new Date(i.startedAt), now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {charts.map(({ key, chart }) => (
            <div key={key} className="cache-mini-chart">
              <h4>{t(`messaging.chart.metric.${key}`)}</h4>
              <LineChart
                series={chart.series}
                unit={chart.unit}
                height={140}
                formatTime={(ts) => formatTime(ts, range === '15m')}
                emptyText={t('messaging.chart.empty')}
                ariaLabel={t(`messaging.chart.metric.${key}`)}
              />
            </div>
          ))}
          <h4>{t('messaging.errors.recent')}</h4>
          {data.recentErrors.length === 0 ? (
            <p className="cache-ok-line">{t('messaging.errors.noneHere')}</p>
          ) : (
            <ul className="cache-key-list">
              {data.recentErrors.map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <span>
                    {formatTime(Date.parse(e.at), true)} · <code>{e.channel}</code> · {e.message}
                  </span>
                  <span className="is-warn">{t(`messaging.errors.kind.${e.kind}`)}</span>
                </li>
              ))}
            </ul>
          )}
          <h4>{t('messaging.message.recent')}</h4>
          <SectionState section={data.recentMessages} scope="messaging">
            {(rows) => <MessageTable rows={rows} onOpen={onOpenMessage} columns={['time', 'id', 'channel', 'status', 'duration']} emptyText={t('messaging.message.none')} now={now} />}
          </SectionState>
        </>
      )}
    </DbDrawer>
  );
};
