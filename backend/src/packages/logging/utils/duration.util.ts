import { performance } from 'node:perf_hooks';

/** Đo thời gian thực thi (ms) của một hàm đồng bộ hoặc bất đồng bộ để gắn `durationMs` vào log. */
export async function measureDurationMs<T>(
  fn: () => Promise<T> | T,
): Promise<{ result: T; durationMs: number }> {
  const startedAt = performance.now();
  const result = await fn();
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  return { result, durationMs };
}
