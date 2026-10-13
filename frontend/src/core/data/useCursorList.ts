import { useMemo } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';

export interface CursorPage<T> {
  items: T[];
  /** Cursor trang sau; `null` = đã hết. */
  next: string | null;
  /** Số bản ghi backend đã quét để ra trang này (SCAN / list theo trang). */
  examined?: number;
}

/**
 * Danh sách duyệt theo cursor ("Tải thêm"): gộp các trang, bỏ trùng theo id, cộng số đã quét.
 * Không tự làm mới theo chu kỳ (tránh quét nguồn liên tục) — chỉ tải lại khi bấm làm mới / sau thao tác.
 */
export function useCursorList<T, P extends CursorPage<T> = CursorPage<T>>(
  key: QueryKey,
  fetchPage: (cursor: string | null) => Promise<P>,
  getId: (item: T) => string,
  options: { enabled?: boolean } = {},
) {
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: P) => last.next ?? undefined,
    enabled: options.enabled ?? true,
    refetchOnWindowFocus: false,
  });
  const pages = query.data?.pages;
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const page of pages ?? []) {
      for (const item of page.items) {
        const id = getId(item);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(item);
      }
    }
    return out;
  }, [pages, getId]);
  const examined = useMemo(() => (pages ?? []).reduce((sum, p) => sum + (p.examined ?? 0), 0), [pages]);

  return {
    query,
    pages,
    /** Trang mới nhất (trạng thái nguồn, thông tin kèm theo). */
    last: pages?.[pages.length - 1],
    items,
    examined,
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  };
}
