import { useLocale } from '@core/i18n/index';
import { NO_VALUE } from '@core/lib/format';
import { StatGrid, StatTile } from '@core/ui/blocks';
import type { TrafficSummary } from '../../types/traffic.types';
import { errorRateTone, formatRps, statDelta } from '../../utils/traffic-format';
import { useTrafficFormat } from './useTrafficFormat';

/** 5 số chính của khoảng đang xem: tốc độ request, P50, P95, tỷ lệ 5xx (kèm số 5xx / 4xx), request hôm nay. */
export function TrafficKpis({
  summary,
  failed,
  onErrors,
}: {
  summary: TrafficSummary | undefined;
  /** Tải lỗi → ô hiện `—` thay vì khung chờ (banner lỗi ở đầu trang). */
  failed?: boolean;
  onErrors?: () => void;
}) {
  const { t } = useLocale();
  const tf = useTrafficFormat();
  const s = summary?.stats;
  const cmp = summary?.comparison;
  const set = summary?.settings;
  const loading = !summary && !failed;
  const p95Slow = s && set && s.p95LatencyMs !== null && s.p95LatencyMs > set.endpointP95WarnMs;
  const pp = t('tr.unit.pp');

  return (
    <StatGrid columns={5}>
      <StatTile
        wrap
        label={t('tr.kpi.rate')}
        value={s ? formatRps(s.requestsPerSecond) : NO_VALUE}
        unit={t('tr.unit.rps')}
        sub={s ? t('tr.kpi.requests', { count: tf.count(s.requests) }) : undefined}
        delta={statDelta(cmp?.requestsPercent, null)}
        hint={t('tr.kpi.rateHint')}
        loading={loading}
      />
      <StatTile
        wrap
        label={t('tr.kpi.p50')}
        value={tf.latency(s?.p50LatencyMs)}
        sub={s ? t('tr.kpi.avg', { value: tf.latency(s.avgLatencyMs) }) : undefined}
        loading={loading}
      />
      <StatTile
        wrap
        label={t('tr.kpi.p95')}
        value={tf.latency(s?.p95LatencyMs)}
        sub={s ? t('tr.kpi.p99', { value: tf.latency(s.p99LatencyMs) }) : undefined}
        tone={!s || s.p95LatencyMs === null ? undefined : p95Slow ? 'warn' : 'ok'}
        delta={statDelta(cmp?.p95Percent, true)}
        hint={
          set
            ? t('tr.kpi.p95Hint', {
                threshold: tf.latency(set.endpointP95WarnMs),
              })
            : undefined
        }
        loading={loading}
      />
      <StatTile
        wrap
        label={t('tr.kpi.errorRate')}
        value={tf.rate(s?.errorRatePercent)}
        sub={
          s
            ? t('tr.kpi.errorCounts', {
                server: tf.count(s.serverErrors),
                client: tf.count(s.clientErrors),
              })
            : undefined
        }
        tone={summary ? errorRateTone(summary) : undefined}
        delta={statDelta(cmp?.errorRateDelta, true, ` ${pp}`)}
        hint={
          set
            ? t('tr.kpi.errorRateHint', {
                warn: set.errorRateWarnPercent,
                crit: set.errorRateCritPercent,
              })
            : undefined
        }
        onClick={onErrors}
        loading={loading}
      />
      <StatTile wrap label={t('tr.kpi.today')} value={tf.count(summary?.requestsToday)} hint={t('tr.kpi.todayHint')} loading={loading} />
    </StatGrid>
  );
}
