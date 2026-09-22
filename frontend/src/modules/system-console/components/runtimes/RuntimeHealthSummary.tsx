import React from 'react';
import type { RuntimesOverview } from '../../types/runtime.types';
import { formatMb, percent } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** KPI đầu trang: Running / Warnings / Down / Restarts hôm nay / CPU / RAM tổng. */
export const RuntimeHealthSummary: React.FC<{ summary: RuntimesOverview['summary'] | null }> = ({ summary }) => {
  const { t } = useLocale();
  const items = summary
    ? [
        { key: 'running', value: `${summary.running} / ${summary.total}`, tone: summary.running === summary.total ? 'ok' : 'warn' },
        { key: 'warnings', value: summary.warnings, tone: summary.warnings > 0 ? 'warn' : 'ok' },
        { key: 'down', value: summary.down, tone: summary.down > 0 ? 'crit' : 'ok' },
        { key: 'restartsToday', value: summary.restartsToday, tone: 'unknown' },
        { key: 'totalCpu', value: percent(summary.totalCpuPercent), tone: 'unknown' },
        {
          key: 'totalMemory',
          value: summary.totalMemoryLimitMb
            ? `${formatMb(summary.totalMemoryMb)} / ${formatMb(summary.totalMemoryLimitMb)}`
            : formatMb(summary.totalMemoryMb),
          tone: 'unknown',
        },
      ]
    : [];

  return (
    <div className="ov-kpi-grid">
      {summary
        ? items.map((item) => (
            <div key={item.key} className={`ov-card ov-kpi ov-tone-${item.tone}`}>
              <span className="ov-kpi-label">{t(`rt.summary.${item.key}`)}</span>
              <span className="ov-kpi-value">{item.value}</span>
            </div>
          ))
        : Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="ov-card ov-kpi">
              <span className="ov-skeleton" style={{ width: '60%', height: 12 }} />
              <span className="ov-skeleton" style={{ width: '45%', height: 28, marginTop: 14 }} />
            </div>
          ))}
    </div>
  );
};
