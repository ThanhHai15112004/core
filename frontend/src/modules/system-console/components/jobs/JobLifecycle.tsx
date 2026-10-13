import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Timeline, type TimelineItem } from '@core/ui/blocks';
import type { LifecycleStep } from '../../types/jobs.types';
import { LIFECYCLE_TONE } from '../../constants/jobs';
import { instanceLabel } from '../../utils/jobs-format';

const MS_DIGITS = 3;
const ms = (at: string | null) => (at ? Date.parse(at) : null);

/** Vòng đời job: Tạo → Vào queue → Worker nhận → Xử lý → Lỗi / Retry / Xong, kèm khoảng thời gian giữa các bước. */
export function JobLifecycle({ steps }: { steps: LifecycleStep[] }) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const precise = (at: string | null) => {
    if (!at) return NO_VALUE;
    const d = new Date(at);
    return `${formatTime(d, true)}.${String(d.getMilliseconds()).padStart(MS_DIGITS, '0')}`;
  };
  const label = (s: LifecycleStep) => {
    const who = s.instance ? instanceLabel(s.instance) : s.runtime;
    switch (s.kind) {
      case 'enqueued':
        return t('jobs.lifecycle.enqueued', { queue: s.queue ?? '' });
      case 'picked':
        return who ? t('jobs.lifecycle.pickedBy', { worker: who, attempt: s.attempt ?? 1 }) : t('jobs.lifecycle.picked', { attempt: s.attempt ?? 1 });
      case 'scheduled':
        return s.current ? t('jobs.lifecycle.runsAt') : t('jobs.lifecycle.scheduled', { delay: f.duration(s.delayMs) });
      case 'retry_scheduled':
        return t('jobs.lifecycle.retryScheduled', { attempt: (s.attempt ?? 0) + 1, delay: f.duration(s.delayMs) });
      case 'retried_manually':
        return s.actor ? t('jobs.lifecycle.retriedBy', { actor: s.actor }) : t('jobs.lifecycle.retried_manually');
      default:
        return t(`jobs.lifecycle.${s.kind}`);
    }
  };
  const items: TimelineItem[] = steps.map((s, i) => {
    const prev = i > 0 ? ms(steps[i - 1].at) : null;
    const cur = ms(s.at);
    const gap = prev !== null && cur !== null && !s.current && cur - prev > 0 ? f.duration(cur - prev) : undefined;
    const detail = s.errorType ? <span className="font-mono text-crit-fg">{s.errorType}</span> : s.error ? s.error : s.kind === 'cancelled' && s.actor ? t('jobs.lifecycle.by', { actor: s.actor }) : undefined;
    return {
      id: `${s.kind}-${i}`,
      tone: LIFECYCLE_TONE[s.kind] ?? 'unknown',
      title: label(s),
      time: s.current && s.kind !== 'scheduled' ? t('jobs.lifecycle.now') : precise(s.at),
      detail,
      gap,
      current: s.current,
    };
  });
  return <Timeline items={items} />;
}
