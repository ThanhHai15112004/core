import { useState, useCallback } from 'react';
import type { LatencyDataPoint } from '../types/console.types';

const MAX_POINTS = 25;

/** Lưu độ trễ round-trip thật của các lần gọi `/health`. */
export function useLatencyTracker() {
  const [latencyHistory, setLatencyHistory] = useState<LatencyDataPoint[]>([]);

  const recordLatency = useCallback((latencyMs: number) => {
    const time = new Date().toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLatencyHistory((prev) => [...prev, { time, latencyMs }].slice(-MAX_POINTS));
  }, []);

  const currentLatency = latencyHistory[latencyHistory.length - 1]?.latencyMs ?? 0;
  const avgLatency =
    latencyHistory.length > 0
      ? Math.round(latencyHistory.reduce((acc, cur) => acc + cur.latencyMs, 0) / latencyHistory.length)
      : 0;

  return { latencyHistory, currentLatency, avgLatency, recordLatency };
}
