import { Clock } from 'lucide-react';
import { useLocale } from '../../i18n/index';
import { useLive } from '../../data/live-context';
import { TIME_RANGES, type TimeRange } from '../../constants/ui.constants';
import { Button } from '../primitives/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../primitives/dropdown-menu';

interface TimeRangePickerProps {
  /** Các range trang hỗ trợ (mặc định tất cả). */
  options?: readonly TimeRange[];
  /** Range đang có hiệu lực (sau khi giới hạn theo `options`) — xem `useTimeRange`. */
  value?: TimeRange;
}

/** Chọn khoảng thời gian toàn cục (lưu ở DataProvider). */
export function TimeRangePicker({ options = TIME_RANGES, value }: TimeRangePickerProps) {
  const { t } = useLocale();
  const { range, setRange } = useLive();
  const current = value ?? range;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={t('ui.time.range')}>
          <Clock />
          <span className="hidden sm:inline">{t('ui.time.last', { range: t(`ui.time.ranges.${current}`) })}</span>
          <span className="font-mono sm:hidden">{current}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('ui.time.range')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={(v) => setRange(v as TimeRange)}>
          {options.map((r) => (
            <DropdownMenuRadioItem key={r} value={r}>
              {t('ui.time.last', { range: t(`ui.time.ranges.${r}`) })}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
