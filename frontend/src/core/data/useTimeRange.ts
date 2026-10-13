import { useMemo } from 'react';
import { useLive } from './live-context';
import { TIME_RANGES, TIME_RANGE_MS, type TimeRange } from '../constants/ui.constants';

/**
 * Khoảng thời gian toàn cục, giới hạn theo các giá trị trang hỗ trợ.
 * Range đang chọn không được hỗ trợ → lấy giá trị gần nhất (không đổi lựa chọn của người dùng).
 */
export function useTimeRange<R extends TimeRange = TimeRange>(allowed: readonly R[] = TIME_RANGES as unknown as readonly R[]): R {
  const { range } = useLive();
  return useMemo(() => {
    if ((allowed as readonly TimeRange[]).includes(range)) return range as R;
    const target = TIME_RANGE_MS[range];
    return allowed.reduce((best, r) => (Math.abs(TIME_RANGE_MS[r] - target) < Math.abs(TIME_RANGE_MS[best] - target) ? r : best), allowed[0]);
  }, [allowed, range]);
}
