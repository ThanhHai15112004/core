import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { TIME_RANGE_MS } from '@core/constants/ui.constants';
import { AlertList, DetailSection } from '@core/ui/blocks';
import { TimeSeriesChart } from '@core/ui/charts';
import type { MessagingError, MessagingRange, MessagingSeries } from '../../types/messaging.types';
import { seriesFormatter, toTimeSeries } from '../../utils/messaging-format';

/** Biểu đồ nhỏ trong drawer channel / consumer (series theo đơn vị backend, khác đơn vị → trục phải). */
export function SeriesSection({ title, list, range, now }: { title: string; list: MessagingSeries[]; range: MessagingRange; now: number }) {
  const { t } = useLocale();
  const f = useFormat();
  const chart = toTimeSeries(list);
  return (
    <DetailSection title={title}>
      <TimeSeriesChart
        series={chart.series}
        format={seriesFormatter(chart.unit, f.locale)}
        {...(chart.rightUnit ? { formatRight: seriesFormatter(chart.rightUnit, f.locale) } : {})}
        height="sm"
        xRange={{ from: now - TIME_RANGE_MS[range], to: now }}
        emptyMessage={t('messaging.chart.empty')}
        ariaLabel={title}
      />
    </DetailSection>
  );
}

/** Lỗi gần đây của một channel / consumer (lỗi cuối cùng → dead letter tô đỏ). */
export function RecentErrors({ errors, showChannel }: { errors: MessagingError[]; showChannel?: boolean }) {
  const { t } = useLocale();
  return (
    <DetailSection title={t('messaging.errors.recent')}>
      <AlertList
        emptyMessage={t('messaging.errors.noneHere')}
        items={errors.map((e, i) => ({
          id: `${e.at}-${e.messageId}-${i}`,
          tone: e.final ? 'crit' : 'warn',
          title: e.message,
          detail: [t(`messaging.errors.kind.${e.kind}`), showChannel ? e.channel : null, t('messaging.errors.attempt', { attempt: e.attempt, max: e.maxAttempts })]
            .filter(Boolean)
            .join(' · '),
          since: e.at,
        }))}
      />
    </DetailSection>
  );
}
