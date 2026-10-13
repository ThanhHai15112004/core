import { AlertTriangle } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { KeyValueGrid, PanelState, UsageBar } from '@core/ui/blocks';
import type { Concurrency, WorkerRow } from '../../types/worker.types';
import { CONCURRENCY_WARN_PERCENT } from '../../constants/worker';
import { instanceLabel } from '../../utils/worker-format';
import { DENSE_GRID } from './worker-ui';

const THRESHOLDS = { warn: CONCURRENCY_WARN_PERCENT, crit: 100 };

/**
 * Concurrency: cấu hình / đang dùng / còn trống / mức dùng + mức dùng từng worker (active ÷ concurrency).
 * Chỉ báo "gần giới hạn" — Console không tự đề xuất số instance cần scale.
 */
export function ConcurrencyPanel({ concurrency, workers }: { concurrency: Concurrency | null; workers: WorkerRow[] }) {
  const { t } = useLocale();
  const f = useFormat();
  if (!concurrency) return <PanelState status="empty" compact message={t('wq.concurrency.none')} />;
  const near = (concurrency.utilizationPercent ?? 0) >= CONCURRENCY_WARN_PERCENT;
  return (
    <>
      <KeyValueGrid
        columns={4}
        className={DENSE_GRID[4]}
        items={[
          { label: t('wq.concurrency.configured'), value: f.number(concurrency.configured), mono: true },
          { label: t('wq.concurrency.active'), value: f.number(concurrency.active), mono: true },
          { label: t('wq.concurrency.available'), value: f.number(concurrency.available), mono: true },
          { label: t('wq.concurrency.utilization'), value: <span className={near ? 'text-warn-fg' : undefined}>{f.percent(concurrency.utilizationPercent)}</span>, mono: true },
        ]}
      />
      {near && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-warn-fg">
          <AlertTriangle className="size-3.5" />
          {t('wq.concurrency.near')}
        </p>
      )}
      {workers.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {workers.map((w) => {
            const pct = w.active !== null && w.concurrency > 0 ? (w.active / w.concurrency) * 100 : null;
            return (
              <li key={w.id} className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate font-mono text-xs text-fg-2" title={w.id}>
                  {instanceLabel(w.id)}
                </span>
                <UsageBar percent={pct} thresholds={THRESHOLDS} showValue={false} className="flex-1" />
                <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-fg-2">
                  {w.active ?? NO_VALUE} / {w.concurrency}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
