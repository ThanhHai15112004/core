import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLive } from '@core/data';
import type { JobFilters, JobRow } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { EXPLORER_PAGE_SIZE } from '../../constants/jobs';
import { jobKey } from '../../utils/jobs-format';
import { jobsKeys } from './jobs-keys';

/**
 * Tìm job theo bộ lọc, phân trang bằng cursor ("Tải thêm"). Trang đầu tự làm mới theo chu kỳ chung; đã tải thêm trang
 * thì ngừng tự làm mới để danh sách không nhảy khi đang xem (bấm làm mới vẫn tải lại).
 */
export function useJobSearch(filters: JobFilters, enabled = true) {
  const { refreshMs } = useLive();
  const query = useInfiniteQuery({
    queryKey: jobsKeys.search(filters),
    queryFn: ({ pageParam }) => jobsApi.search(filters, pageParam, EXPLORER_PAGE_SIZE),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (q) => (refreshMs > 0 && (q.state.data?.pages.length ?? 0) <= 1 ? refreshMs : false),
    enabled,
  });
  const pages = query.data?.pages;
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: JobRow[] = [];
    for (const p of pages ?? [])
      for (const j of p.jobs) {
        const k = jobKey(j);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(j);
        }
      }
    return out;
  }, [pages]);
  const first = pages?.[0];
  const last = pages?.[pages.length - 1];
  return { query, rows, first, last };
}
