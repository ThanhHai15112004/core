import React, { useCallback, useMemo, useState } from 'react';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { createQueryClient } from './query-client';
import { LiveContext } from './live-context';
import {
  DEFAULT_REFRESH_MS,
  DEFAULT_TIME_RANGE,
  REFRESH_OPTIONS_MS,
  TIME_RANGES,
  UI_STORAGE_KEYS,
  type RefreshMs,
  type TimeRange,
} from '../constants/ui.constants';

function readStored<T>(key: string, allowed: readonly T[], fallback: T, parse: (raw: string) => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = parse(raw);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage bị chặn: chỉ giữ trong phiên */
  }
}

const LiveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [refreshMs, setRefreshState] = useState<RefreshMs>(() =>
    readStored<RefreshMs>(UI_STORAGE_KEYS.refreshMs, REFRESH_OPTIONS_MS, DEFAULT_REFRESH_MS, (r) => Number(r) as RefreshMs),
  );
  const [range, setRangeState] = useState<TimeRange>(() =>
    readStored<TimeRange>(UI_STORAGE_KEYS.timeRange, TIME_RANGES, DEFAULT_TIME_RANGE, (r) => r as TimeRange),
  );

  const setRefreshMs = useCallback((ms: RefreshMs) => {
    setRefreshState(ms);
    writeStored(UI_STORAGE_KEYS.refreshMs, String(ms));
  }, []);
  const setRange = useCallback((r: TimeRange) => {
    setRangeState(r);
    writeStored(UI_STORAGE_KEYS.timeRange, r);
  }, []);
  const refreshNow = useCallback(() => {
    void queryClient.refetchQueries({ type: 'active' });
  }, [queryClient]);

  const value = useMemo(() => ({ refreshMs, setRefreshMs, range, setRange, refreshNow }), [refreshMs, setRefreshMs, range, setRange, refreshNow]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
};

/** QueryClient + cài đặt làm mới / khoảng thời gian dùng chung. */
export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <LiveProvider>{children}</LiveProvider>
    </QueryClientProvider>
  );
};
