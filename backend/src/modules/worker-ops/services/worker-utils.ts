import type { RedisService } from '@packages/redis/index.js';
import { runtimeKeys, type RuntimeHeartbeat } from '@packages/runtime/index.js';
import type { QueueInfo } from '@packages/queue/index.js';

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

export const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const iso = (t: number | null | undefined) =>
  t === null || t === undefined ? null : new Date(t).toISOString();

export const secondsSince = (t: number | null, now: number) =>
  t === null ? null : Math.max(0, Math.round((now - t) / 1000));

/** Job đang chờ của queue (waiting + prioritized). */
export const waitingOf = (q: QueueInfo) => q.counts.waiting + q.counts.prioritized;

const MAX_REASON = 80;

/**
 * Lý do lỗi đã chuẩn hoá để gộp nhóm: `StorageTimeout: bucket x…` → `StorageTimeout`; message tự do thì bỏ
 * số / id (để "timeout after 5000ms" và "timeout after 3000ms" chung một nhóm) và cắt ngắn.
 */
export function reasonOf(message: string | null | undefined): string {
  const raw = (message ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'Unknown';
  const head = /^([A-Z][A-Za-z0-9_]*(?:Error|Exception|Timeout|Failure|Fault))\b/.exec(raw);
  if (head) return head[1]!;
  const code = /^([A-Z][A-Z0-9_]{2,})\b/.exec(raw);
  if (code) return code[1]!;
  const normalized = raw
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
    .replace(/\d+(\.\d+)?/g, '#');
  return normalized.length > MAX_REASON ? `${normalized.slice(0, MAX_REASON)}…` : normalized;
}

/** Heartbeat runtime worker (một bản ghi mỗi runtime — instance mới nhất). */
export async function readWorkerHeartbeat(redis: RedisService): Promise<RuntimeHeartbeat | null> {
  if (!redis.isReady()) return null;
  const raw = await redis.client.get(runtimeKeys(redis).heartbeat('worker')).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RuntimeHeartbeat;
  } catch {
    return null;
  }
}
