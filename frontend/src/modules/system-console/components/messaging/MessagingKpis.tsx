import React from 'react';
import type { MessagingOverview } from '../../types/messaging.types';
import { formatCompact } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatMsgRate } from '../../utils/messaging-format';
import type { StatusTone } from '../../utils/status-tone';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** 8 KPI: publish/s, consume/s, lag, lỗi, đang retry, dead letter, consumer, channel. */
export const MessagingKpis: React.FC<{ data: MessagingOverview | null }> = ({ data }) => {
  const { t, locale } = useLocale();
  if (!data) {
    return (
      <div className="ov-kpi-grid db-kpi-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="ov-card ov-kpi">
            <span className="ov-skeleton" style={{ width: '60%', height: 12 }} />
            <span className="ov-skeleton" style={{ width: '45%', height: 28, marginTop: 14 }} />
          </div>
        ))}
      </div>
    );
  }
  const k = data.kpis;
  const alert = (...rules: string[]): StatusTone | null => {
    const hits = data.alerts.filter((a) => rules.includes(a.rule));
    return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.some((a) => a.severity === 'warning') ? 'warn' : null;
  };
  const range = t(`tr.range.${data.range}`);
  const n = (v: number | null) => (v === null ? NO_VALUE : formatCompact(v, locale));
  const lagChange = data.lagTrend.changePercent;
  const items: { key: string; value: string; sub: string; tone: StatusTone }[] = [
    { key: 'published', value: formatMsgRate(k.publishedPerSec), sub: t('messaging.kpi.totalSub', { count: n(data.delivery.published), range }), tone: 'unknown' },
    {
      key: 'consumed',
      value: formatMsgRate(k.consumedPerSec),
      sub: t('messaging.kpi.totalSub', { count: n(data.delivery.consumed), range }),
      tone: data.balance.state === 'growing' ? 'warn' : 'unknown',
    },
    {
      key: 'lag',
      value: n(k.lag),
      sub:
        data.lagTrend.ago15m === null
          ? t('messaging.kpi.lagSubNone')
          : t('messaging.kpi.lagSub', { value: n(data.lagTrend.ago15m), change: lagChange === null ? NO_VALUE : `${lagChange > 0 ? '+' : ''}${formatUnit(lagChange, '%')}` }),
      tone: alert('LAG_HIGH', 'LAG_GROWING', 'NO_CONSUMER') ?? (k.lag === null ? 'unknown' : 'ok'),
    },
    {
      key: 'failed',
      value: String(k.failed),
      sub: t('messaging.kpi.failedSub', { rate: formatUnit(data.delivery.failureRatePercent, '%'), range }),
      tone: alert('FAILURE_RATE', 'PUBLISH_FAILURES') ?? (k.failed > 0 ? 'warn' : 'ok'),
    },
    { key: 'retrying', value: n(k.retrying), sub: t('messaging.kpi.retryingSub', { count: n(data.delivery.retried), range }), tone: (k.retrying ?? 0) > 0 ? 'warn' : 'unknown' },
    {
      key: 'deadLetter',
      value: n(k.deadLetter),
      sub: t('messaging.kpi.deadLetterSub', { count: n(data.delivery.deadLettered), range }),
      tone: alert('DEAD_LETTER') ?? ((k.deadLetter ?? 0) > 0 ? 'warn' : k.deadLetter === null ? 'unknown' : 'ok'),
    },
    {
      key: 'consumers',
      value: n(k.consumers),
      sub: t('messaging.kpi.consumersSub', { count: data.consumers.length }),
      tone: alert('NO_CONSUMER', 'CONSUMER_PAUSED') ?? 'unknown',
    },
    { key: 'channels', value: String(k.channels), sub: t(`messaging.kpi.channelsSub.${data.provider.channelTerm}`), tone: 'unknown' },
  ];
  return (
    <div className="ov-kpi-grid db-kpi-grid">
      {items.map((i) => (
        <div key={i.key} className={`ov-card ov-kpi ov-tone-${i.tone}`}>
          <span className="ov-kpi-label">{t(`messaging.kpi.${i.key}`)}</span>
          <span className="ov-kpi-value">{i.value}</span>
          <span className="ov-kpi-sub">{i.sub}</span>
        </div>
      ))}
    </div>
  );
};
