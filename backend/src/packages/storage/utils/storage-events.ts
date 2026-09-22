import { randomBytes } from 'node:crypto';
import type { RedisService } from '@packages/redis/index.js';
import {
  STORAGE_EVENT_LOG_SIZE,
  STORAGE_OPERATION_LOG_SIZE,
  storageKeys,
} from '../constants/storage.keys.js';
import type {
  StorageEventRecord,
  StorageOperationRecord,
} from '../contracts/storage-events.types.js';

const id = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

/** Ghi một sự kiện storage (bỏ qua khi Redis chưa sẵn sàng). */
export async function recordStorageEvent(
  redis: RedisService | undefined,
  event: Omit<StorageEventRecord, 'id' | 'at'> & { at?: number },
): Promise<void> {
  if (!redis?.isReady()) return;
  const record: StorageEventRecord = { id: id('se'), at: Date.now(), ...event };
  const key = storageKeys(redis).events();
  await redis.client
    .multi()
    .lpush(key, JSON.stringify(record))
    .ltrim(key, 0, STORAGE_EVENT_LOG_SIZE - 1)
    .exec()
    .catch(() => undefined);
}

export async function recordStorageOperation(
  redis: RedisService | undefined,
  op: Omit<StorageOperationRecord, 'id'>,
): Promise<StorageOperationRecord> {
  const record: StorageOperationRecord = { id: id('sop'), ...op };
  if (!redis?.isReady()) return record;
  const key = storageKeys(redis).operations();
  await redis.client
    .multi()
    .lpush(key, JSON.stringify(record))
    .ltrim(key, 0, STORAGE_OPERATION_LOG_SIZE - 1)
    .exec()
    .catch(() => undefined);
  return record;
}
