import { randomBytes } from 'node:crypto';
import type { RedisService } from '@packages/redis/index.js';
import {
  QUEUE_EVENT_LOG_SIZE,
  QUEUE_OPERATION_LOG_SIZE,
  queueKeys,
} from '../constants/queue.keys.js';
import type { QueueEventRecord, QueueOperationRecord } from '../contracts/queue-events.types.js';

const id = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

async function push(redis: RedisService, key: string, value: unknown, size: number) {
  await redis.client
    .multi()
    .lpush(key, JSON.stringify(value))
    .ltrim(key, 0, size - 1)
    .exec()
    .catch(() => undefined);
}

/** Ghi một sự kiện queue (bỏ qua khi Redis chưa sẵn sàng). */
export async function recordQueueEvent(
  redis: RedisService | undefined,
  event: Omit<QueueEventRecord, 'id' | 'at'> & { at?: number },
): Promise<void> {
  if (!redis?.isReady()) return;
  const record: QueueEventRecord = { id: id('qe'), at: Date.now(), ...event };
  await push(redis, queueKeys(redis).events(), record, QUEUE_EVENT_LOG_SIZE);
}

export async function recordQueueOperation(
  redis: RedisService | undefined,
  op: Omit<QueueOperationRecord, 'id'>,
): Promise<QueueOperationRecord> {
  const record: QueueOperationRecord = { id: id('qop'), ...op };
  if (redis?.isReady())
    await push(redis, queueKeys(redis).operations(), record, QUEUE_OPERATION_LOG_SIZE);
  return record;
}
