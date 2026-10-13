import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { ConfigGroups, ConfigSheet, PanelState, type ConfigGroup } from '@core/ui/blocks';
import type { MetricValue, RuntimeDetail } from '../../types/runtime.types';

const valueOf = (v: MetricValue | undefined) => (v === null || v === undefined || v === '' ? null : String(v));

/** Cấu hình runtime (chỉ đọc): loại / framework / cổng / môi trường, thông tin developer, ngưỡng cảnh báo. */
export function RuntimeConfigSheet({ d, open, onOpenChange }: { d: RuntimeDetail | undefined; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const desc = d?.descriptor ?? null;
  const r = d?.resources ?? null;
  const groups: ConfigGroup[] = d
    ? [
        {
          id: 'runtime',
          title: t('rt.detail.configuration'),
          items: [
            { label: t('rt.config.type'), value: desc ? t(`rt.type.${desc.type}`) : null },
            { label: t('rt.config.framework'), value: desc?.framework },
            { label: t('rt.config.adapter'), value: desc?.adapter },
            { label: t('rt.config.port'), value: desc?.port, mono: true },
            { label: t('rt.config.environment'), value: d.environment },
            { label: t('rt.metric.memoryLimit'), value: r ? `${f.mb(r.memoryLimitMb)} · ${t(`rt.memorySource.${r.memoryLimitSource}`)}` : null },
            { label: t('rt.process.supervisor'), value: d.supervisor },
            ...Object.entries(desc?.details ?? {}).map(([k, v]) => ({ key: k, label: k, value: valueOf(v), mono: true })),
          ],
        },
        {
          id: 'developer',
          title: t('rt.detail.developer'),
          items: [
            { label: t('rt.config.source'), value: desc?.sourcePath, mono: true },
            { label: t('rt.config.entrypoint'), value: desc?.entrypoint, mono: true },
          ],
        },
        {
          id: 'thresholds',
          title: t('rt.detail.thresholds'),
          items: [
            { label: t('rt.metric.memoryPercent'), value: f.percent(d.thresholds.memoryPercent), mono: true },
            { label: t('rt.metric.cpu'), value: f.percent(d.thresholds.cpuPercent), mono: true },
            { label: t('rt.metric.eventLoop'), value: f.duration(d.thresholds.eventLoopMs), mono: true },
          ],
        },
      ]
    : [];
  return (
    <ConfigSheet open={open} onOpenChange={onOpenChange} title={t('rt.detail.settingsTitle', { name: d?.name ?? '' })}>
      {d ? <ConfigGroups groups={groups} /> : <PanelState status="loading" />}
    </ConfigSheet>
  );
}
