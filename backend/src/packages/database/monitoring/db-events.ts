import { randomBytes } from 'node:crypto';
import type { RedisService } from '@packages/redis/index.js';
import { EVENT_LOG_SIZE, databaseKeys } from '../constants/database.keys.js';
import type { DbEventRecord } from '../contracts/database-events.types.js';

/** Ghi một sự kiện database vào Redis (bỏ qua khi Redis chưa sẵn sàng — sự kiện không được làm hỏng luồng chính). */
export async function recordDbEvent(
  redis: RedisService | undefined,
  event: Omit<DbEventRecord, 'id' | 'at'> & { at?: number },
): Promise<void> {
  if (!redis?.isReady()) return;
  const record: DbEventRecord = {
    id: `dbe_${randomBytes(6).toString('hex')}`,
    at: Date.now(),
    ...event,
  };
  const key = databaseKeys(redis).events();
  await redis.client
    .multi()
    .lpush(key, JSON.stringify(record))
    .ltrim(key, 0, EVENT_LOG_SIZE - 1)
    .exec()
    .catch(() => undefined);
}
