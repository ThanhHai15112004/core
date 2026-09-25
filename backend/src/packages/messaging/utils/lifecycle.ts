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
  };
  void Promise.resolve()
    .then(() => job.log(JSON.stringify(row)))
    .catch(() => undefined);
}
