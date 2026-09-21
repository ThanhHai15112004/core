import { useState, useCallback } from 'react';
import type { LatencyDataPoint } from '../types/console.types';

const MAX_POINTS = 25;

export function useLatencyTracker() {
  const [latencyHistory, setLatencyHistory] = useState<LatencyDataPoint[]>(() => {
    // initialize with initial idle points
    const now = new Date();
    return Array.from({ length: 10 }).map((_, i) => {
      const d = new Date(now.getTime() - (10 - i) * 3000);
      return {
        time: d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        latencyMs: 12 + Math.floor(Math.random() * 8),
      };
    });
  });

  const recordLatency = useCallback((latencyMs: number) => {
    const time = new Date().toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLatencyHistory((prev) => {
      const next = [...prev, { time, latencyMs }];
      if (next.length > MAX_POINTS) {
        return next.slice(next.length - MAX_POINTS);
      }
      return next;
    });
  }, []);

  const currentLatency = latencyHistory[latencyHistory.length - 1]?.latencyMs ?? 0;
  const avgLatency =
    latencyHistory.length > 0
      ? Math.round(latencyHistory.reduce((acc, cur) => acc + cur.latencyMs, 0) / latencyHistory.length)
      : 0;

  return {
    latencyHistory,
    currentLatency,
    avgLatency,
    recordLatency,
  };
}
