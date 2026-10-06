import type { Queue } from 'bullmq';
import type {
  MessagingConnectionService,
  QueueName,
  QueueRegistry,
} from '@packages/messaging/index.js';
import type { RedisService } from '@packages/redis/index.js';
import { runtimeKeys, type RuntimeHeartbeat } from '@packages/runtime/index.js';

/**
 * Queue BullMQ đọc được ngay. BullMQ chờ Redis vô hạn — broker chưa kết nối thì trả rỗng để request
 * không bị treo (lệnh vẫn bọc `withTimeout` phòng kết nối chập chờn).
 */
export function liveQueues(
  registry: QueueRegistry,
  connection: MessagingConnectionService,
): Map<QueueName, Queue> {
  return connection.getStatus().state === 'connected' ? registry.getQueues() : new Map();
}

export const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Lệch UTC hiện tại của múi giờ IANA, vd. `+07:00` (theo DST tại thời điểm `at`). */
export function utcOffsetOf(timeZone: string, at = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    const offset = name?.replace('GMT', '') ?? '';
    return offset === '' ? '+00:00' : offset;
  } catch {
    return '+00:00';
  }
}

/** Heartbeat Runtime Monitor của scheduler (trạng thái running / paused, uptime). */
export async function readSchedulerHeartbeat(
  redis: RedisService,
): Promise<RuntimeHeartbeat | null> {
  if (!redis.isReady()) return null;
  const raw = await redis.client.get(runtimeKeys(redis).heartbeat('scheduler')).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RuntimeHeartbeat;
  } catch {
    return null;
  }
}
