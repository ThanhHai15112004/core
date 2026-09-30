import type { RedisService } from '@packages/redis/index.js';

/** Key Redis của Logs (đã có REDIS_PREFIX). Bản thân log nằm ở ring buffer `runtime:logs:<runtime>`. */
export const logsKeys = (redis: RedisService) => ({
  /** Hash fingerprint → ErrorGroupMeta (JSON, mẫu gần nhất). */
  groupMeta: () => redis.key('logs', 'eg', 'meta'),
  /** Hash fingerprint → lần đầu xuất hiện (epoch ms, HSETNX). */
  groupFirst: () => redis.key('logs', 'eg', 'first'),
  /** ZSET fingerprint → lần cuối xuất hiện (epoch ms). */
  groupLast: () => redis.key('logs', 'eg', 'last'),
  /** Hash fingerprint → tổng số lần. */
  groupCount: () => redis.key('logs', 'eg', 'count'),
  /** Hash `<fp>|<dim>|<value>` → số lần (dim: rt runtime, job loại job, route endpoint). */
  groupDims: () => redis.key('logs', 'eg', 'dims'),
  /** Hash runtime → LogLevelOverrideRecord (JSON). */
  level: () => redis.key('logs', 'level'),
  /** Hash `<runtime>@<instance>` → LogIngestState (JSON): lần ghi thành công cuối, số log mất. */
  ingest: () => redis.key('logs', 'ingest'),
  /** LIST audit thao tác trên chính Logs (đổi level, export). */
  operations: () => redis.key('logs', 'ops'),
});

/** Log/phút đo bằng telemetry: `log.l.<level>`; byte: `log.b`; mất: `log.drop`; nhóm lỗi: `log.eg.<fp>`. */
export const LOG_METRIC = {
  level: (level: string) => `log.l.${level}`,
  bytes: 'log.b',
  dropped: 'log.drop',
  redacted: 'log.redact',
  traceable: 'log.tr',
  group: (fp: string) => `log.eg.${fp}`,
  groupOther: 'log.eg._other',
  module: (ctx: string) => `log.m.${ctx}`,
  moduleErrors: (ctx: string) => `log.me.${ctx}`,
  moduleOther: '_other',
} as const;

export const LOGS_OPERATION_LOG_SIZE = 500;
/** Số nhóm lỗi / module khác nhau tối đa một process ghi metric riêng (phần còn lại gộp `_other`). */
export const LOG_METRIC_CARDINALITY = 300;
