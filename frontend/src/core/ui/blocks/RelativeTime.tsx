import { useLocale } from '../../i18n/index';
import { useTicker } from '../../hooks/useTicker';
import { RELATIVE_TIME_TICK_MS } from '../../constants/ui.constants';
import { NO_VALUE } from '../../lib/format';
import { cn } from '../../lib/cn';

/** "5 phút trước" (tự cập nhật, dùng chung một đồng hồ) + tooltip thời điểm đầy đủ. */
export function RelativeTime({ value, className }: { value: string | number | Date | null | undefined; className?: string }) {
  const { formatRelative, formatTime } = useLocale();
  const now = useTicker(RELATIVE_TIME_TICK_MS);
  if (value === null || value === undefined || value === '') return <span className={cn('text-faint', className)}>{NO_VALUE}</span>;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return <span className={cn('text-faint', className)}>{NO_VALUE}</span>;
  return (
    <time dateTime={date.toISOString()} title={`${date.toLocaleDateString()} ${formatTime(date)}`} className={className}>
      {formatRelative(date, now)}
    </time>
  );
}
