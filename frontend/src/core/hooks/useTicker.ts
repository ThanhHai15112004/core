import { useSyncExternalStore } from 'react';

/**
 * Đồng hồ dùng chung: mọi component cùng chu kỳ chia sẻ MỘT interval (thay vì mỗi "x giây trước" một timer).
 */
const stores = new Map<number, { now: number; listeners: Set<() => void>; timer: ReturnType<typeof setInterval> | null }>();

function storeFor(intervalMs: number) {
  let s = stores.get(intervalMs);
  if (!s) {
    s = { now: Date.now(), listeners: new Set(), timer: null };
    stores.set(intervalMs, s);
  }
  return s;
}

export function useTicker(intervalMs: number): number {
  const s = storeFor(intervalMs);
  return useSyncExternalStore(
    (cb) => {
      s.listeners.add(cb);
      if (!s.timer) {
        s.timer = setInterval(() => {
          s.now = Date.now();
          s.listeners.forEach((l) => l());
        }, intervalMs);
      }
      return () => {
        s.listeners.delete(cb);
        if (s.listeners.size === 0 && s.timer) {
          clearInterval(s.timer);
          s.timer = null;
        }
      };
    },
    () => s.now,
    () => s.now,
  );
}
