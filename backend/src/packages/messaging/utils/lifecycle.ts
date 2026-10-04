import type { Job } from 'bullmq';
import type { LifecycleEntry, LifecycleType } from '../contracts/messaging-events.types.js';

/** Ghi một dòng vòng đời vào job log của BullMQ (tra cứu được theo message ID). */
export function logLifecycle(
  job: Pick<Job, 'log'>,
  type: LifecycleType,
  entry: Partial<Omit<LifecycleEntry, 'type'>> = {},
): void {
  const row: LifecycleEntry = {
    at: entry.at ?? Date.now(),
    type,
    runtime: entry.runtime ?? null,
    consumer: entry.consumer ?? null,
    attempt: entry.attempt ?? null,
    ms: entry.ms ?? null,
    error: entry.error ?? null,
    delayMs: entry.delayMs ?? null,
    ...(entry.instance !== undefined ? { instance: entry.instance } : {}),
    ...(entry.errorType !== undefined ? { errorType: entry.errorType } : {}),
    ...(entry.retryable !== undefined ? { retryable: entry.retryable } : {}),
    ...(entry.dependency !== undefined ? { dependency: entry.dependency } : {}),
    ...(entry.actor !== undefined ? { actor: entry.actor } : {}),
  };
  void Promise.resolve()
    .then(() => job.log(JSON.stringify(row)))
    .catch(() => undefined);
}

/** Đọc các dòng vòng đời từ job log (bỏ qua dòng log khác), cũ nhất trước. */
export function parseLifecycle(rows: string[]): LifecycleEntry[] {
  const out: LifecycleEntry[] = [];
  for (const row of rows) {
    try {
      const e = JSON.parse(row) as LifecycleEntry;
      if (e && typeof e.at === 'number' && typeof e.type === 'string') out.push(e);
    } catch {
      /* dòng log do handler tự ghi → bỏ qua */
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
