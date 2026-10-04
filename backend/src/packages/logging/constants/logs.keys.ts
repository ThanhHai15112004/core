import type { RedisService } from '@packages/redis/index.js';

/** Key Redis của Logs (đã có REDIS_PREFIX). Bản thân log nằm ở Redis Stream `logs:<env>`. */
export const logsKeys = (redis: RedisService) => ({
  /** Redis Stream chứa log JSON (pino) của mọi runtime — field `d`. */
  stream: (env: string) => redis.key('logs', env),
  /** Hash runtime → LogLevelOverrideRecord (JSON). */
  level: () => redis.key('logs', 'level'),
  /** Hash `<runtime>@<instance>` → LogIngestState (JSON): lần ghi thành công cuối, số log mất. */
  ingest: () => redis.key('logs', 'ingest'),
  /** LIST audit thao tác trên chính Logs (đổi level, export). */
  operations: () => redis.key('logs', 'ops'),
});

/** Giữ khoảng chừng này log gần nhất trong stream (`XADD … MAXLEN ~`). */
export const LOGS_STREAM_MAXLEN = 50_000;
export const LOGS_OPERATION_LOG_SIZE = 500;
