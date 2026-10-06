import { randomBytes } from 'node:crypto';
import type { RedisService } from '@packages/redis/index.js';
import {
  CACHE_EVENT_LOG_SIZE,
  CACHE_OPERATION_LOG_SIZE,
  cacheKeys,
} from '../constants/cache.keys.js';
import type { CacheEventRecord, CacheOperationRecord } from '../contracts/cache-events.types.js';

const id = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

/** Ghi một sự kiện cache (bỏ qua khi Redis chưa sẵn sàng — không được làm hỏng luồng chính). */
export async function recordCacheEvent(
  redis: RedisService | undefined,
  event: Omit<CacheEventRecord, 'id' | 'at'> & { at?: number },
): Promise<void> {
  if (!redis?.isReady()) return;
  const record: CacheEventRecord = { id: id('ce'), at: Date.now(), ...event };
  const key = cacheKeys(redis).events();
  await redis.client
    .multi()
    .lpush(key, JSON.stringify(record))
    .ltrim(key, 0, CACHE_EVENT_LOG_SIZE - 1)
    .exec()
    .catch(() => undefined);
}

export async function recordCacheOperation(
  redis: RedisService,
  op: Omit<CacheOperationRecord, 'id'>,
): Promise<CacheOperationRecord> {
  const record: CacheOperationRecord = { id: id('cop'), ...op };
  const key = cacheKeys(redis).operations();
  await redis.client
    .multi()
    .lpush(key, JSON.stringify(record))
    .ltrim(key, 0, CACHE_OPERATION_LOG_SIZE - 1)
    .exec()
    .catch(() => undefined);
  return record;
}
