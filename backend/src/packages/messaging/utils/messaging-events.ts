import { randomBytes } from 'node:crypto';
import type { RedisService } from '@packages/redis/index.js';
import {
  MESSAGING_EVENT_LOG_SIZE,
  MESSAGING_OPERATION_LOG_SIZE,
  messagingKeys,
} from '../constants/messaging.keys.js';
import type {
  MessagingEventRecord,
  MessagingOperationRecord,
} from '../contracts/messaging-events.types.js';

/** Trích xuất hoặc tạo mã định danh duy nhất cho bản ghi */
const id = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

/** Thêm một sự kiện mới vào danh sách và duy trì giới hạn kích thước tối đa */
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

/** Ghi nhận thao tác vận hành messaging vào lịch sử */
export async function recordMessagingOperation(
  redis: RedisService | undefined,
  op: Omit<MessagingOperationRecord, 'id'>,
): Promise<MessagingOperationRecord> {
  const record: MessagingOperationRecord = { id: id('mop'), ...op };
  if (redis?.isReady())
    await push(redis, messagingKeys(redis).operations(), record, MESSAGING_OPERATION_LOG_SIZE);
  return record;
}
