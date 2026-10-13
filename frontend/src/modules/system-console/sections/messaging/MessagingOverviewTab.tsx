import { useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { CHART_GROUP, TIME_RANGE_MS } from '@core/constants/ui.constants';
import { NO_VALUE, formatDelta } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import {
  AlertList,
  ComparisonTable,
  Panel,
  PanelGrid,
  PanelState,
  StatGrid,
  StatTile,
  type AlertItem,
  type ComparisonRow,
  type StatDelta, AvailableView } from '@core/ui/blocks';
import { MetricChart, type MetricStat } from '@core/ui/charts';
import type { MessagingMetric, MessagingOverview, MessagingReport } from '../../types/messaging.types';
import type { Tone } from '@core/theme';
import { messagingApi } from '../../services/messaging.api';
import { CONSUMER_RULES, DEAD_LETTER_RULES, FAILURE_RULES, LAG_RULES, MESSAGING_METRICS, SEVERITY_TONE } from '../../constants/messaging';
import { ChannelTable } from '../../components/messaging/ChannelTable';
import { QueueDepthTable } from '../../components/messaging/QueueDepthTable';
import { MessageTable } from '../../components/messaging/MessageTable';
import { formatMsgRate, formatSignedRate, seriesFormatter, toTimeSeries } from '../../utils/messaging-format';
import { messagingKeys } from './messaging-keys';
import type { MessagingPage } from './useMessagingPage';

const REPORT_ROWS: { key: keyof MessagingReport; higherIsWorse: boolean | null }[] = [
  { key: 'published', higherIsWorse: null },
  { key: 'consumed', higherIsWorse: null },
  { key: 'failed', higherIsWorse: true },
  { key: 'retried', higherIsWorse: true },
  { key: 'deadLettered', higherIsWorse: true },
  { key: 'avgProcessingMs', higherIsWorse: true },
  { key: 'avgLag', higherIsWorse: true },
  { key: 'peakLag', higherIsWorse: true },
];

/** Tổng quan: 6 chỉ số → biểu đồ luồng message + vấn đề → channel + độ sâu queue → dead letter + báo cáo ngày. */
interface Props {
  page: MessagingPage;
  data: MessagingOverview | undefined;
  /** Lỗi tải overview lần đầu (chưa có dữ liệu) → panel hiện lỗi + thử lại thay vì chờ mãi. */
  error: unknown;
  onRetry: () => void;
}

export function MessagingOverviewTab({ page, data, error, onRetry }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const { range, go, openChannel, openMessage, openLegacy } = page;
  const [metric, setMetric] = useState<MessagingMetric>('throughput');
  const metrics = useLiveQuery(messagingKeys.metrics(range, metric), () => messagingApi.metrics(range, metric));
  const chart = metrics.data ? toTimeSeries(metrics.data.series) : null;
  const k = data?.kpis;
  const d = data?.delivery ?? null;
  const rangeLabel = t(`messaging.range.${range}`);

  /** Tông KPI theo cảnh báo backend đang mở (nặng nhất). */
  const alertTone = (rules: string[]): Tone | null => {
    const hits = (data?.alerts ?? []).filter((a) => rules.includes(a.rule));
    return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.some((a) => a.severity === 'warning') ? 'warn' : null;
  };

  const lag = data?.lagTrend;
  const lagDelta: StatDelta | null =
    lag && lag.changePercent !== null && lag.direction
      ? { text: formatDelta(lag.changePercent) ?? NO_VALUE, direction: lag.direction, good: lag.direction === 'flat' ? null : lag.direction === 'down' }
      : null;

  const b = data?.balance;
  const p = data?.processing;
  const stats: Record<MessagingMetric, MetricStat[]> = {
    throughput: [
      { label: t('messaging.kpi.published'), value: formatMsgRate(b?.publishedPerSec, f.locale) },
      { label: t('messaging.kpi.consumed'), value: formatMsgRate(b?.consumedPerSec, f.locale) },
      {
        label: t('messaging.balance.diff'),
        value: b?.state === 'growing' && b.growthPerHour !== null ? t('messaging.balance.growing', { diff: formatSignedRate(b.diffPerSec, f.locale), perHour: f.compact(b.growthPerHour) }) : formatSignedRate(b?.diffPerSec, f.locale),
      },
    ],
    lag: [
      { label: t('messaging.lagTrend.current'), value: f.compact(lag?.current) },
      { label: t('messaging.lagTrend.ago'), value: f.compact(lag?.ago15m) },
      { label: t('messaging.lagTrend.change'), value: formatDelta(lag?.changePercent) ?? NO_VALUE },
    ],
    failures: [
      { label: t('messaging.kpi.failed'), value: f.compact(k?.failed) },
      { label: t('messaging.channel.failureRate'), value: f.percent(d?.failureRatePercent) },
      { label: t('messaging.delivery.recovered'), value: d ? t('messaging.delivery.recoveredOf', { recovered: f.compact(d.recovered), retried: f.compact(d.retried) }) : NO_VALUE },
    ],
    processing: [
      { label: t('messaging.processing.avg'), value: f.duration(p?.avgMs) },
      { label: t('messaging.processing.p95'), value: f.duration(p?.p95Ms) },
      { label: t('messaging.processing.p99'), value: f.duration(p?.p99Ms) },
    ],
  };

  const alerts: AlertItem[] = (data?.alerts ?? []).map((a) => ({
    id: a.id,
    tone: SEVERITY_TONE[a.severity],
    title: a.target ? `${a.title} · ${a.target}` : a.title,
    detail: a.message,
    since: a.since,
    onInspect: () => openLegacy(a.tab),
  }));
  const rules = new Set((data?.alerts ?? []).map((a) => a.rule));
  const okChecks: string[] = [];
  if (data) {
    if (data.health.state === 'connected') okChecks.push(t('messaging.alerts.connected'));
    if (data.queues.available && !CONSUMER_RULES.some((r) => rules.has(r))) okChecks.push(t('messaging.alerts.consumersOk'));
    if (data.kpis.lag !== null && !LAG_RULES.some((r) => rules.has(r))) okChecks.push(t('messaging.alerts.lagOk'));
    if (data.kpis.deadLetter === 0) okChecks.push(t('messaging.alerts.noDeadLetter'));
  }

  const report = data?.report;
  const reportRows: ComparisonRow[] = REPORT_ROWS.map(({ key, higherIsWorse }) => ({
    id: key,
    label: t(`messaging.report.${key}`),
    current: report?.today?.[key] ?? null,
    previous: report?.yesterday?.[key] ?? null,
    format: key === 'avgProcessingMs' ? (v) => f.duration(v) : (v) => f.compact(v),
    higherIsWorse,
  }));

  const now = metrics.dataUpdatedAt || Date.now();
  const loading = !data && !error;
  const pending = (className?: string) => <PanelState status={error ? 'error' : 'loading'} error={error} onRetry={onRetry} compact={Boolean(error)} className={className} />;
  return (
    <>
      <StatGrid columns={6}>
        <StatTile
          label={t('messaging.kpi.published')}
          value={formatMsgRate(k?.publishedPerSec, f.locale)}
          sub={d ? t('messaging.kpi.total', { count: f.compact(d.published), range: rangeLabel }) : undefined}
          loading={loading}
          onClick={() => go('channels')}
        />
        <StatTile
          label={t('messaging.kpi.consumed')}
          value={formatMsgRate(k?.consumedPerSec, f.locale)}
          sub={d ? t('messaging.kpi.total', { count: f.compact(d.consumed), range: rangeLabel }) : undefined}
          tone={b?.state === 'growing' ? 'warn' : undefined}
          loading={loading}
          onClick={() => go('channels')}
        />
        <StatTile
          label={t('messaging.kpi.lag')}
          value={f.compact(k?.lag)}
          delta={lagDelta}
          hint={t('messaging.kpi.lagHint')}
          tone={alertTone([...LAG_RULES, 'NO_CONSUMER']) ?? (k?.lag === null || k?.lag === undefined ? undefined : 'ok')}
          loading={loading}
          onClick={() => go('channels')}
        />
        <StatTile
          label={t('messaging.kpi.failed')}
          value={f.compact(k?.failed)}
          sub={d ? t('messaging.kpi.failedSub', { rate: f.percent(d.failureRatePercent) }) : undefined}
          tone={alertTone(FAILURE_RULES) ?? (k?.failed === null || k?.failed === undefined ? undefined : k.failed > 0 ? 'warn' : 'ok')}
          loading={loading}
          onClick={() => go('activity')}
        />
        <StatTile
          label={t('messaging.kpi.retrying')}
          value={f.compact(k?.retrying)}
          sub={d ? t('messaging.kpi.retryingSub', { count: f.compact(d.retried), range: rangeLabel }) : undefined}
          tone={(k?.retrying ?? 0) > 0 ? 'warn' : undefined}
          loading={loading}
          onClick={() => go('messages', { state: 'retry' })}
        />
        <StatTile
          label={t('messaging.kpi.deadLetter')}
          value={f.compact(k?.deadLetter)}
          sub={d ? t('messaging.kpi.deadLetterSub', { count: f.compact(d.deadLettered), range: rangeLabel }) : undefined}
          tone={alertTone(DEAD_LETTER_RULES) ?? (k?.deadLetter === null || k?.deadLetter === undefined ? undefined : k.deadLetter > 0 ? 'warn' : 'ok')}
          loading={loading}
          onClick={() => go('messages', { state: 'dead-letter' })}
        />
      </StatGrid>

      <PanelGrid layout="2-1">
        <MetricChart
          title={t('messaging.chart.title')}
          hint={t(metric === 'lag' ? 'messaging.chart.noteLag' : 'messaging.chart.note')}
          metrics={MESSAGING_METRICS.map((m) => ({ id: m, label: t(`messaging.chart.metric.${m}`) }))}
          value={metric}
          onChange={setMetric}
          series={chart?.series}
          error={metrics.error}
          onRetry={() => void metrics.refetch()}
          stats={data ? stats[metric] : undefined}
          format={seriesFormatter(chart?.unit ?? '', f.locale)}
          {...(chart?.rightUnit ? { formatRight: seriesFormatter(chart.rightUnit, f.locale) } : {})}
          group={CHART_GROUP}
          xRange={{ from: now - TIME_RANGE_MS[range], to: now }}
          emptyMessage={t('messaging.chart.empty')}
        />
        <Panel title={t('messaging.alerts.title')}>{data ? <AlertList items={alerts} okChecks={okChecks} emptyMessage={okChecks.length ? undefined : t('messaging.alerts.none')} /> : pending()}</Panel>
      </PanelGrid>

      <Panel title={t('messaging.queue.title')} hint={t('messaging.queue.hint')} flush className="mb-4">
        {data ? (
          <div className={data.queues.available ? undefined : 'p-3'}>
            <AvailableView source={data.queues} product={data.provider.product}>
              {(rows) => <QueueDepthTable rows={rows} emptyMessage={t('messaging.queue.empty')} />}
            </AvailableView>
          </div>
        ) : (
          pending('p-3')
        )}
      </Panel>

      <PanelGrid layout="2-1">
        <Panel
          title={t('messaging.channel.title')}
          flush
          actions={
            <>
              {k && <Badge>{f.number(k.channels)}</Badge>}
              <Button size="xs" variant="ghost" onClick={() => go('channels')}>
                {t('messaging.channel.viewAll')}
              </Button>
            </>
          }
        >
          {data ? <ChannelTable rows={data.topChannels} onOpen={openChannel} compact emptyMessage={t('messaging.channel.empty')} /> : pending('p-3')}
        </Panel>
        <Panel title={t('messaging.report.title')} hint={t('messaging.report.hint')}>
          {data ? (
            report?.today || report?.yesterday ? (
              <ComparisonTable rows={reportRows} labels={{ current: t('messaging.report.today'), previous: t('messaging.report.yesterday') }} />
            ) : (
              <PanelState status="empty" compact message={t('messaging.report.unavailable')} />
            )
          ) : (
            pending()
          )}
        </Panel>
      </PanelGrid>

      <Panel
        className="mb-4"
        title={t('messaging.deadLetter.title')}
        flush
        actions={
          <>
            {data?.deadLetter.available && <Badge tone={data.deadLetter.data.total > 0 ? 'crit' : undefined}>{f.compact(data.deadLetter.data.total)}</Badge>}
            <Button size="xs" variant="ghost" onClick={() => go('messages', { state: 'dead-letter' })}>
              {t('messaging.deadLetter.open')}
            </Button>
          </>
        }
      >
        {data ? (
          <div className={data.deadLetter.available ? undefined : 'p-3'}>
            <AvailableView source={data.deadLetter} product={data.provider.product}>
              {(dl) => <MessageTable rows={dl.latest} onOpen={openMessage} columns={['time', 'id', 'channel', 'attempts', 'error']} emptyMessage={t('messaging.deadLetter.empty')} />}
            </AvailableView>
          </div>
        ) : (
          pending('p-3')
        )}
      </Panel>
    </>
  );
}
