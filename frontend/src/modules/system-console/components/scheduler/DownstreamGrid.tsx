import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import { KeyValueGrid } from '@core/ui/blocks';
import type { Downstream } from '../../types/scheduler.types';

/** Queue mà task đẩy job vào: chờ / đang xử lý / lỗi / worker — hoặc lý do không đọc được. */
export function DownstreamGrid({ downstream }: { downstream: Downstream }) {
  const { t } = useLocale();
  const f = useFormat();
  const s = downstream.state;
  const queue = (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-xs">{downstream.queue}</span>
      {s?.paused && <Badge tone="unknown">{t('sch.downstream.paused')}</Badge>}
    </span>
  );
  if (!s)
    return (
      <KeyValueGrid
        items={[
          { label: t('sch.exec.job.queue'), value: queue },
          { label: t('sch.downstream.reason'), value: downstream.reason },
        ]}
      />
    );
  const stuck = s.waiting > 0 && s.workers === 0;
  return (
    <KeyValueGrid
      columns={3}
      items={[
        { label: t('sch.exec.job.queue'), value: queue },
        { label: t('sch.downstream.waiting'), value: <span className={stuck ? 'text-crit-fg' : undefined}>{f.compact(s.waiting)}</span>, mono: true },
        { label: t('sch.downstream.active'), value: f.compact(s.active), mono: true },
        { label: t('sch.downstream.delayed'), value: f.compact(s.delayed), mono: true },
        { label: t('sch.downstream.failed'), value: <span className={s.failed > 0 ? 'text-warn-fg' : undefined}>{f.compact(s.failed)}</span>, mono: true },
        { label: t('sch.downstream.workers'), value: s.workers === null ? null : String(s.workers), mono: true },
      ]}
    />
  );
}
