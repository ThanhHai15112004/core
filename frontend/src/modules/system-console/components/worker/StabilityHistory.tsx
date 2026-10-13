import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { ActivityFeed, KeyValueGrid, type ActivityItem } from '@core/ui/blocks';
import type { WorkerStability } from '../../types/worker.types';

const BAD_REASONS = new Set(['crash', 'unexpected']);

/** Restart / crash hôm nay + lịch sử restart (lấy từ Runtime Monitor của runtime worker). */
export function StabilityHistory({ stability, counts = true }: { stability: WorkerStability; counts?: boolean }) {
  const { t } = useLocale();
  const f = useFormat();
  const items: ActivityItem[] = stability.history.map((h, i) => ({
    id: `${h.at}-${i}`,
    at: h.at,
    tone: BAD_REASONS.has(h.reasonCode) ? 'crit' : 'info',
    title: h.reason,
    detail: h.downtimeMs === null ? null : t('wq.stability.downtime', { value: f.duration(h.downtimeMs) }),
  }));
  return (
    <>
      {counts && (
        <KeyValueGrid
          className="mb-3"
          items={[
            { label: t('wq.stability.restarts'), value: <span className={stability.restartsToday > 0 ? 'text-warn-fg' : undefined}>{f.number(stability.restartsToday)}</span>, mono: true },
            { label: t('wq.stability.crashes'), value: <span className={stability.crashesToday > 0 ? 'text-crit-fg' : undefined}>{f.number(stability.crashesToday)}</span>, mono: true },
          ]}
        />
      )}
      <ActivityFeed items={items} emptyMessage={t('wq.stability.none')} />
    </>
  );
}
