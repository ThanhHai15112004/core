import { useLocale } from '@core/i18n/index';
import { ConfigGroups, ConfigSheet, PanelState } from '@core/ui/blocks';
import type { PerformanceOverview } from '../../types/performance.types';
import { usePerfFormat } from '../../components/performance/perf-format';

/** Cách đánh giá hiệu năng (chỉ đọc): cửa sổ / chu kỳ đánh giá, ngưỡng tài nguyên, mục tiêu PERF_BUDGET_*, nguồn số đo. */
export function PerfConfigSheet({ data, open, onOpenChange }: { data: PerformanceOverview | undefined; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLocale();
  const fmt = usePerfFormat();
  const s = data?.settings;
  return (
    <ConfigSheet open={open} onOpenChange={onOpenChange} title={t('perf.config.title')} subtitle={t('perf.config.note')}>
      {data && s ? (
        <ConfigGroups
          groups={[
            {
              id: 'evaluation',
              title: t('perf.config.evaluation'),
              items: [
                { label: t('perf.config.window'), value: t('perf.config.minutes', { count: s.windowMin }), hint: t('perf.config.windowHint') },
                { label: t('perf.config.evaluate'), value: t('perf.config.seconds', { count: s.evaluateSec }) },
                { label: t('perf.config.resolution'), value: s.resolutionSec ? t('perf.config.seconds', { count: s.resolutionSec }) : null },
                { label: t('perf.config.cpuThreshold'), value: fmt(s.thresholds.cpuPercent, '%'), mono: true },
                { label: t('perf.config.memoryThreshold'), value: fmt(s.thresholds.memoryPercent, '%'), mono: true },
              ],
            },
            {
              id: 'budgets',
              title: t('perf.budgets.title'),
              items: data.budgets.map((b) => ({ key: b.key, label: t(`perf.budgets.${b.key}`), value: fmt(b.target, b.unit), mono: true })),
            },
            {
              id: 'telemetry',
              title: t('perf.config.telemetry'),
              items: [
                { label: t('perf.config.perfSource'), value: t(data.telemetry.performance ? 'perf.config.active' : 'perf.config.inactive') },
                { label: t('perf.config.trafficSource'), value: t(data.telemetry.traffic ? 'perf.config.active' : 'perf.config.inactive') },
                { label: t('perf.config.dbSource'), value: t(data.telemetry.database === 'active' ? 'perf.config.active' : 'perf.config.inactive') },
              ],
            },
          ]}
        />
      ) : (
        <PanelState status="loading" />
      )}
    </ConfigSheet>
  );
}
