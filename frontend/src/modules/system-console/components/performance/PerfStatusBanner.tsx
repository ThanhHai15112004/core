import React from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import type { PerformanceOverview } from '../../types/performance.types';
import { LEVEL_TONE } from '../../constants/performance';
import { useLocale } from '../../../../core/i18n/index';

const ICONS = { normal: CheckCircle2, degraded: AlertTriangle, critical: AlertOctagon, unknown: HelpCircle } as const;

/** Trạng thái hiệu năng tổng: Bình thường / Suy giảm / Nghiêm trọng theo ngưỡng rõ ràng (không dùng điểm số). */
export const PerfStatusBanner: React.FC<{ data: PerformanceOverview }> = ({ data }) => {
  const { t } = useLocale();
  const { level, reasons } = data.status;
  const Icon = ICONS[level];
  return (
    <section className={`pf-status ov-tone-${LEVEL_TONE[level]}`} role="status">
      <Icon size={22} className="pf-status-icon" />
      <div>
        <strong>{t(`perf.level.${level}`)}</strong>
        <p>
          {level === 'unknown'
            ? t('perf.levelHint.unknown')
            : reasons.length
              ? reasons.join(' • ')
              : t('perf.levelHint.normal', { minutes: data.settings.windowMin })}
        </p>
      </div>
    </section>
  );
};
