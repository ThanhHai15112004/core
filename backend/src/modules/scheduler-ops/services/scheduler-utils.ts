import type { RedisService } from '@packages/redis/index.js';
import { runtimeKeys, type RuntimeHeartbeat } from '@packages/runtime/index.js';
import type {
  ExecutionRecord,
  SchedulerInstanceRecord,
  TaskStateRecord,
} from '@packages/scheduler/index.js';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** Lịch kế tiếp quá hạn hơn chừng này (scheduler vẫn sống) → task "overdue". */
export const OVERDUE_GRACE_MS = MINUTE;

export const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const iso = (t: number | null | undefined) =>
  t === null || t === undefined ? null : new Date(t).toISOString();

export const isAlive = (i: SchedulerInstanceRecord, now: number, timeoutSec: number) =>
  now - i.at <= timeoutSec * 1000;

/** Instance còn sống + heartbeat mới nhất (kể cả instance đã chết, để nói "mất heartbeat bao lâu"). */
export function liveness(
  instances: ReadonlyMap<string, SchedulerInstanceRecord>,
  now: number,
  timeoutSec: number,
) {
  const all = [...instances.values()];
  const alive = all.filter((i) => isAlive(i, now, timeoutSec));
  const lastAt = all.reduce<number | null>((m, i) => (m === null || i.at > m ? i.at : m), null);
  return {
    all,
    alive,
    aliveIds: new Set(alive.map((i) => i.instance)),
    lastAt,
    ageSec: lastAt === null ? null : Math.max(0, Math.round((now - lastAt) / 1000)),
    paused: alive.length > 0 && alive.every((i) => i.paused),
  };
}

/** Lần chạy còn ghi "running" nhưng instance đã chết (process bị kill giữa chừng). */
export const isOrphan = (
  r: ExecutionRecord,
  aliveIds: ReadonlySet<string>,
  now: number,
  timeoutSec: number,
) =>
  r.status === 'running' &&
  (r.instance === null || !aliveIds.has(r.instance)) &&
  now - (r.startedAt ?? now) > timeoutSec * 1000;

/** Lịch kế tiếp đã quá hạn (giây) — null nếu chưa. */
export function overdueSec(state: TaskStateRecord | undefined, now: number): number | null {
  if (!state?.nextRunAt || now - state.nextRunAt <= OVERDUE_GRACE_MS) return null;
  return Math.round((now - state.nextRunAt) / 1000);
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
