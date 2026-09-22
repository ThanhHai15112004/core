import type { RedisService } from '@packages/redis/index.js';
import type { RuntimeId } from '../contracts/runtime.types.js';

/** Tất cả key Redis của runtime telemetry (đã có REDIS_PREFIX). */
export const runtimeKeys = (redis: RedisService) => ({
  heartbeat: (id: RuntimeId) => redis.key('runtime', 'hb', id),
  samples: (id: RuntimeId) => redis.key('runtime', 'ts', id),
  starts: (id: RuntimeId) => redis.key('runtime', 'starts', id),
  paused: (id: RuntimeId) => redis.key('runtime', 'paused', id),
  logs: (id: RuntimeId) => redis.key('runtime', 'logs', id),
  commandChannel: (id: RuntimeId) => redis.key('runtime', 'cmd', id),
  commandRecord: (commandId: string) => redis.key('runtime', 'cmdrec', commandId),
  commandResult: (commandId: string) => redis.key('runtime', 'cmdres', commandId),
  events: () => redis.key('runtime', 'events'),
  cliHistory: () => redis.key('runtime', 'cli', 'history'),
});

/** Kết quả lệnh giữ lại 1 giờ. */
export const COMMAND_TTL_SEC = 3600;
