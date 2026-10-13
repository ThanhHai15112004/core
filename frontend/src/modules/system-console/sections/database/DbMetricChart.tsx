import { useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { TIME_RANGE_MS } from '@core/constants/ui.constants';
import { UNIT } from '@core/lib/format';
import { MetricChart, type TimeSeries } from '@core/ui/charts';
import type { DbMetric, DbRange } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { DB_METRICS, DB_SERIES_COLOR } from '../../constants/database';
import { dbKeys } from './database-keys';

/** Biểu đồ hiệu năng database (đo từ query của app): query/s, latency, kết nối, lỗi. */
export function DbMetricChart({ range }: { range: DbRange }) {
  const { t } = useLocale();
  const f = useFormat();
  const [metric, setMetric] = useState<DbMetric>('queries');
  const q = useLiveQuery(dbKeys.metrics(range, metric), () => databaseApi.metrics(range, metric));
  const d = q.data?.metric === metric ? q.data : undefined;
  const unit = d?.unit ?? '';
  const fmt = (v: number | null) => (unit === UNIT.perSec ? f.rate(v) : unit === UNIT.perMin ? f.rate(v, 'min') : f.withUnit(v, unit));
  const series: TimeSeries[] | undefined = d?.series.map((s, i) => ({
    id: s.id,
    label: s.label,
    color: DB_SERIES_COLOR[s.id],
    area: i === 0,
    points: s.points.map((p) => ({ t: p.t, v: p.value })),
  }));
  const now = q.dataUpdatedAt || Date.now();
  return (
    <MetricChart
      title={t('db.chart.title')}
      hint={t('db.chart.note')}
      metrics={DB_METRICS.map((id) => ({ id, label: t(`db.chart.metric.${id}`) }))}
      value={metric}
      onChange={setMetric}
      series={series}
      error={q.error}
      onRetry={() => void q.refetch()}
      format={fmt}
      emptyMessage={t('db.chart.empty')}
      legend={(series?.length ?? 0) > 1}
      xRange={{ from: now - TIME_RANGE_MS[range], to: now }}
    />
  );
}
