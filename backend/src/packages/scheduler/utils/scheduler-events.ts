import { randomBytes } from 'node:crypto';
import type { RedisService } from '@packages/redis/index.js';
import {
  SCHEDULER_EVENT_LOG_SIZE,
  SCHEDULER_OPERATION_LOG_SIZE,
  schedulerKeys,
} from '../constants/scheduler.keys.js';
import type {
  SchedulerEventRecord,
  SchedulerOperationRecord,
} from '../contracts/scheduler.types.js';

export const schedulerId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

async function push(redis: RedisService, key: string, value: unknown, size: number) {
  await redis.client
    .multi()
    .lpush(key, JSON.stringify(value))
    .ltrim(key, 0, size - 1)
    .exec()
    .catch(() => undefined);
}

/** Ghi một sự kiện scheduler (bỏ qua khi Redis chưa sẵn sàng). */
export async function recordSchedulerEvent(
  redis: RedisService | undefined,
  event: Omit<SchedulerEventRecord, 'id' | 'at' | 'taskId' | 'executionId' | 'params'> &
    Partial<Pick<SchedulerEventRecord, 'at' | 'taskId' | 'executionId' | 'params'>>,
): Promise<void> {
  if (!redis?.isReady()) return;
  const record: SchedulerEventRecord = {
    id: schedulerId('se'),
    at: Date.now(),
    taskId: null,
    executionId: null,
    params: {},
    ...event,
  };
  await push(redis, schedulerKeys(redis).events(), record, SCHEDULER_EVENT_LOG_SIZE);
}

/** Audit thao tác của người vận hành (Run Now / Enable / Disable). */
export async function recordSchedulerOperation(
  redis: RedisService | undefined,
  op: Omit<SchedulerOperationRecord, 'id'>,
): Promise<SchedulerOperationRecord> {
  const record: SchedulerOperationRecord = { id: schedulerId('sop'), ...op };
  if (redis?.isReady())
    await push(redis, schedulerKeys(redis).operations(), record, SCHEDULER_OPERATION_LOG_SIZE);
  return record;
}
