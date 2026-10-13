import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from '@core/data';
import type { LogFilters, LogRow } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { DEFAULT_LIVE_BUFFER, LIVE_POLL_MS, SEARCH_PAGE_SIZE, TAIL_PAGE_SIZE } from '../../constants/logs';
import { logsKeys } from './logs-keys';

/** Cursor của log mới nhất đang hiển thị (dùng cho lần tail đầu). */
function cursorOfNewest(rows: LogRow[]): string | null {
  const r = rows[0];
  if (!r) return null;
  return btoa(JSON.stringify({ t: Date.parse(r.at), id: r.id }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const cap = (list: LogRow[]) => (list.length > DEFAULT_LIVE_BUFFER ? list.slice(0, DEFAULT_LIVE_BUFFER) : list);
const mergeNew = (incoming: LogRow[], current: LogRow[]) => {
  const seen = new Set(current.map((r) => r.id));
  return cap([...incoming.filter((r) => !seen.has(r.id)), ...current]);
};

/**
 * Luồng log của Explorer: trang đầu theo bộ lọc (query, làm mới theo nút refresh chung), tải log cũ hơn theo cursor,
 * live tail (giữ tối đa DEFAULT_LIVE_BUFFER dòng). Tạm dừng vẫn nhận và đếm log mới, tiếp tục thì chèn vào đầu.
 */
export function useLogStream(filters: LogFilters, liveAllowed: boolean) {
  const first = useLiveQuery(logsKeys.search(filters), () => logsApi.search(filters, null, SEARCH_PAGE_SIZE), { tier: 'static', keepPrevious: false });
  const [rows, setRows] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [olderError, setOlderError] = useState<unknown>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [live, setLive] = useState(liveAllowed);
  const [paused, setPaused] = useState(false);
  const [pending, setPending] = useState<LogRow[]>([]);
  const [pendingMore, setPendingMore] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const latestRef = useRef<string | null>(null);
  const rowsRef = useRef<LogRow[]>([]);
  rowsRef.current = rows;

  // Trang đầu (lần đầu / đổi bộ lọc / bấm làm mới) → thay toàn bộ danh sách.
  useEffect(() => {
    if (!first.data) return;
    setRows(first.data.items);
    setCursor(first.data.nextCursor);
    setPending([]);
    setPendingMore(false);
    setFresh(new Set());
    setOlderError(null);
    latestRef.current = null;
  }, [first.data]);

  useEffect(() => setLive(liveAllowed), [liveAllowed]);

  useEffect(() => {
    if (!live || !first.data) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await logsApi.tail(filters, latestRef.current ?? cursorOfNewest(rowsRef.current), TAIL_PAGE_SIZE);
        if (!alive) return;
        latestRef.current = res.latestCursor;
        if (!res.items.length) return;
        if (paused) {
          setPending((p) => cap([...res.items, ...p]));
          if (res.more) setPendingMore(true);
          return;
        }
        setRows((r) => mergeNew(res.items, r));
        setFresh(new Set(res.items.map((x) => x.id)));
      } catch {
        /* lần sau thử lại; mất kết nối đã báo ở thanh trên */
      }
    };
    const id = setInterval(() => void tick(), LIVE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [live, paused, filters, first.data]);

  const resume = useCallback(() => {
    setRows((r) => mergeNew(pending, r));
    setFresh(new Set(pending.map((x) => x.id)));
    setPending([]);
    setPendingMore(false);
    setPaused(false);
  }, [pending]);

  const loadOlder = useCallback(async () => {
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const res = await logsApi.search(filters, cursor, SEARCH_PAGE_SIZE);
      setRows((r) => {
        const seen = new Set(r.map((x) => x.id));
        return [...r, ...res.items.filter((x) => !seen.has(x.id))];
      });
      setCursor(res.nextCursor);
    } catch (e) {
      setOlderError(e);
    } finally {
      setLoadingOlder(false);
    }
  }, [cursor, filters]);

  return {
    first,
    meta: first.data ?? null,
    rows,
    hasOlder: Boolean(cursor),
    loadingOlder,
    olderError,
    loadOlder,
    live,
    setLive,
    paused,
    pause: () => setPaused(true),
    resume,
    pendingCount: pending.length,
    pendingMore,
    fresh,
  };
}
