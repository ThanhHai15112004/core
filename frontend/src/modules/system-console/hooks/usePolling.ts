import { useCallback, useEffect, useRef, useState } from 'react';
import { POLL_INTERVAL_MS } from '../constants/console.constants';

export interface PollingState<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  lastUpdated: Date | null;
  reload: () => Promise<void>;
}

/**
 * Gọi `fetcher` ngay và định kỳ (tạm dừng khi tab ẩn, tải lại khi quay lại).
 * Giữ dữ liệu lần thành công gần nhất khi lần sau lỗi. `key` đổi → tải lại từ đầu.
 */
export function usePolling<T>(fetcher: () => Promise<T>, key: string, intervalMs = POLL_INTERVAL_MS): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    try {
      setData(await fetcherRef.current());
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setData(null);
    void reload();
    const interval = setInterval(() => {
      if (!document.hidden) void reload();
    }, intervalMs);
    const onVisible = () => {
      if (!document.hidden) void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, intervalMs, reload]);

  return { data, error, isLoading, lastUpdated, reload };
}
