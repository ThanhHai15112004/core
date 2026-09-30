import { randomBytes } from 'node:crypto';
import type { RedisService } from '@packages/redis/index.js';
import { JOB_EVENT_LOG_SIZE, JOB_OPERATION_LOG_SIZE, jobKeys } from '../constants/job.keys.js';
import type { JobEventRecord, JobOperationRecord } from '../contracts/job-events.types.js';

export const jobRecordId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

async function push(redis: RedisService, key: string, value: unknown, size: number) {
  await redis.client
    .multi()
    .lpush(key, JSON.stringify(value))
    .ltrim(key, 0, size - 1)
    .exec()
    .catch(() => undefined);
}

/** Ghi một sự kiện job (bỏ qua khi Redis chưa sẵn sàng). */
export async function recordJobEvent(
  redis: RedisService | undefined,
  event: Omit<JobEventRecord, 'id' | 'at'> & { at?: number },
): Promise<void> {
  if (!redis?.isReady()) return;
  const record: JobEventRecord = { id: jobRecordId('je'), at: Date.now(), ...event };
  await push(redis, jobKeys(redis).events(), record, JOB_EVENT_LOG_SIZE);
}

export async function recordJobOperation(
  redis: RedisService | undefined,
  op: Omit<JobOperationRecord, 'id'>,
): Promise<JobOperationRecord> {
  const record: JobOperationRecord = { id: jobRecordId('jop'), ...op };
  if (redis?.isReady())
    await push(redis, jobKeys(redis).operations(), record, JOB_OPERATION_LOG_SIZE);
  return record;
}
