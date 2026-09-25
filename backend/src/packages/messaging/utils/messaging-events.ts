import { randomBytes } from 'node:crypto';
import type { RedisService } from '@packages/redis/index.js';
import {
  MESSAGING_ERROR_LOG_SIZE,
  MESSAGING_EVENT_LOG_SIZE,
  MESSAGING_OPERATION_LOG_SIZE,
  messagingKeys,
} from '../constants/messaging.keys.js';
import type {
  MessagingErrorRecord,
  MessagingEventRecord,
  MessagingOperationRecord,
} from '../contracts/messaging-events.types.js';

const id = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

async function push(redis: RedisService, key: string, value: unknown, size: number) {
  await redis.client
    .multi()
    .lpush(key, JSON.stringify(value))
    .ltrim(key, 0, size - 1)
    .exec()
    .catch(() => undefined);
}

/** Ghi một sự kiện messaging (bỏ qua khi Redis chưa sẵn sàng). */
export async function recordMessagingEvent(
  redis: RedisService | undefined,
  event: Omit<MessagingEventRecord, 'id' | 'at'> & { at?: number },
): Promise<void> {
  if (!redis?.isReady()) return;
  const record: MessagingEventRecord = { id: id('me'), at: Date.now(), ...event };
  await push(redis, messagingKeys(redis).events(), record, MESSAGING_EVENT_LOG_SIZE);
}

export async function recordMessagingOperation(
  redis: RedisService | undefined,
  op: Omit<MessagingOperationRecord, 'id'>,
): Promise<MessagingOperationRecord> {
  const record: MessagingOperationRecord = { id: id('mop'), ...op };
  if (redis?.isReady())
    await push(redis, messagingKeys(redis).operations(), record, MESSAGING_OPERATION_LOG_SIZE);
  return record;
}

export async function recordMessagingError(
  redis: RedisService | undefined,
  record: MessagingErrorRecord,
): Promise<void> {
  if (!redis?.isReady()) return;
  await push(redis, messagingKeys(redis).errors(), record, MESSAGING_ERROR_LOG_SIZE);
}

/** Giới hạn số bản ghi lỗi mỗi giây (một đợt lỗi hàng loạt không làm ngập Redis). */
export class ErrorRateLimiter {
  private window = { at: 0, n: 0 };

  constructor(private readonly perSec: number) {}

  public allow(now = Date.now()): boolean {
    if (now - this.window.at >= 1000) this.window = { at: now, n: 0 };
    return ++this.window.n <= this.perSec;
  }
}
