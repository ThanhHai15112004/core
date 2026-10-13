import { keepPreviousData, useQuery, type QueryKey, type UseQueryResult } from '@tanstack/react-query';
import { useLive } from './live-context';
import { QUERY_TIER_MULTIPLIER, type QueryTier } from '../constants/ui.constants';

export interface LiveQueryOptions {
  /** Tầng làm mới (mặc định `live`). */
  tier?: QueryTier;
  enabled?: boolean;
  /** Giữ dữ liệu cũ khi key đổi (đổi range/filter) — tắt cho dữ liệu theo id (drawer chi tiết). */
  keepPrevious?: boolean;
}

/**
 * Query tự làm mới theo chu kỳ người dùng chọn ở thanh trên cùng.
 * Tab trình duyệt ẩn → dừng; refresh = Off → chỉ tải lại khi bấm làm mới.
 */
export function useLiveQuery<T>(key: QueryKey, fetcher: () => Promise<T>, options: LiveQueryOptions = {}): UseQueryResult<T> {
  const { refreshMs } = useLive();
  const multiplier = QUERY_TIER_MULTIPLIER[options.tier ?? 'live'];
  const interval = refreshMs > 0 && multiplier > 0 ? refreshMs * multiplier : false;
  return useQuery({
    queryKey: key,
    queryFn: fetcher,
    refetchInterval: interval,
    enabled: options.enabled ?? true,
    placeholderData: options.keepPrevious === false ? undefined : keepPreviousData,
  });
}
