import type { ClusterNode, ClusterOptions, RedisOptions } from 'ioredis';
import type { CacheConfig } from '@packages/config/index.js';
import type { RedisHaMode } from './redis-ha.types.js';

export type RedisCacheConfig = CacheConfig['redis'];

const RECONNECTABLE_REDIS_ERRORS = ['READONLY', 'TRYAGAIN', 'CLUSTERDOWN', 'LOADING'];

/**
 * Tự động kết nối lại và gửi lại lệnh (`2`) khi Redis trả về lỗi chuyển vai trò/failover
 * (`READONLY`, `TRYAGAIN`, `CLUSTERDOWN`, `LOADING`) để không cần restart ứng dụng.
 */
export function shouldReconnectOnRedisError(err: Error): boolean | 1 | 2 {
  const message = (err?.message ?? '').toUpperCase();
  for (const token of RECONNECTABLE_REDIS_ERRORS) {
    if (message.includes(token)) {
      return 2;
    }
  }
  return false;
}

/** Tạo hàm retry backoff tăng dần có trần, có thể giới hạn số lần thử lại (`maxAttempts`). */
export function buildRetryStrategy(
  baseDelayMs: number,
  maxDelayMs: number,
  maxAttempts: number = 0,
): (times: number) => number | null {
  return (times: number) => {
    if (maxAttempts > 0 && times > maxAttempts) {
      return null;
    }
    return Math.min(times * baseDelayMs, maxDelayMs);
  };
}

/** Định dạng endpoint `host:port` phục vụ log & telemetry. */
export function formatEndpoint(host: string, port: number): string {
  return `${host}:${port}`;
}

/** Xây dựng danh sách endpoint cấu hình ban đầu theo mode Redis. */
export function resolveConfiguredEndpoints(redisCfg: RedisCacheConfig): string[] {
  if (redisCfg.mode === 'sentinel') {
    return redisCfg.sentinels.map((s) => formatEndpoint(s.host, s.port));
  }
  if (redisCfg.mode === 'cluster') {
    return redisCfg.clusterNodes.map((n) => formatEndpoint(n.host, n.port));
  }
  return [formatEndpoint(redisCfg.host, redisCfg.port)];
}

/** Xây dựng `RedisOptions` cho mode `standalone` hoặc `sentinel`. */
export function buildRedisClientOptions(
  redisCfg: RedisCacheConfig,
  clientName: string,
  overrides: Partial<RedisOptions> = {},
): RedisOptions {
  const retryStrategy = buildRetryStrategy(
    redisCfg.retryBaseDelayMs,
    redisCfg.retryMaxDelayMs,
    redisCfg.maxReconnectAttempts,
  );
  const base: RedisOptions = {
    db: redisCfg.db,
    connectionName: clientName,
    ...(redisCfg.password ? { password: redisCfg.password } : {}),
    connectTimeout: redisCfg.connectTimeoutMs,
    commandTimeout: redisCfg.commandTimeoutMs,
    ...(redisCfg.keepAliveMs > 0 ? { keepAlive: redisCfg.keepAliveMs } : {}),
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: redisCfg.maxRetriesPerRequest,
    retryStrategy,
    reconnectOnError: shouldReconnectOnRedisError,
  };

  if (redisCfg.mode === 'sentinel') {
    return {
      ...base,
      sentinels: redisCfg.sentinels.map((s) => ({ host: s.host, port: s.port })),
      name: redisCfg.sentinelMasterName,
      role: redisCfg.sentinelRole,
      failoverDetector: true,
      ...(redisCfg.sentinelPassword ? { sentinelPassword: redisCfg.sentinelPassword } : {}),
      sentinelRetryStrategy: retryStrategy,
      ...overrides,
    };
  }

  return {
    ...base,
    host: redisCfg.host,
    port: redisCfg.port,
    ...overrides,
  };
}

/** Xây dựng `{ nodes, options }` cho mode `cluster` (bỏ `db` vì Redis Cluster chỉ hỗ trợ DB 0). */
export function buildClusterClientOptions(
  redisCfg: RedisCacheConfig,
  clientName: string,
  overrides: Partial<ClusterOptions> & {
    maxRetriesPerRequest?: number | null;
    omitCommandTimeout?: boolean;
  } = {},
): { nodes: ClusterNode[]; options: ClusterOptions } {
  const { maxRetriesPerRequest, omitCommandTimeout, ...clusterOverrides } = overrides;
  const retryStrategy = buildRetryStrategy(
    redisCfg.retryBaseDelayMs,
    redisCfg.retryMaxDelayMs,
    redisCfg.maxReconnectAttempts,
  );
  const nodes: ClusterNode[] = redisCfg.clusterNodes.map((n) => ({
    host: n.host,
    port: n.port,
  }));

  const options: ClusterOptions = {
    scaleReads: redisCfg.clusterScaleReads,
    slotsRefreshTimeout: redisCfg.clusterSlotsRefreshTimeoutMs,
    slotsRefreshInterval: redisCfg.clusterSlotsRefreshIntervalMs,
    clusterRetryStrategy: retryStrategy,
    enableOfflineQueue: false,
    lazyConnect: true,
    enableReadyCheck: true,
    retryDelayOnFailover: Math.min(200, redisCfg.retryBaseDelayMs),
    retryDelayOnClusterDown: Math.min(200, redisCfg.retryBaseDelayMs),
    retryDelayOnTryAgain: Math.min(100, redisCfg.retryBaseDelayMs),
    redisOptions: {
      connectionName: clientName,
      ...(redisCfg.password ? { password: redisCfg.password } : {}),
      connectTimeout: redisCfg.connectTimeoutMs,
      ...(!omitCommandTimeout ? { commandTimeout: redisCfg.commandTimeoutMs } : {}),
      ...(redisCfg.keepAliveMs > 0 ? { keepAlive: redisCfg.keepAliveMs } : {}),
      maxRetriesPerRequest:
        maxRetriesPerRequest !== undefined ? maxRetriesPerRequest : redisCfg.maxRetriesPerRequest,
      reconnectOnError: shouldReconnectOnRedisError,
    },
    ...clusterOverrides,
  };

  return { nodes, options };
}

/**
 * Options kết nối BullMQ cho `standalone` hoặc `sentinel`.
 * Không đặt `commandTimeout` vì BullMQ dùng blocking commands (`BZPOPMIN`, `XREAD BLOCK`).
 */
export function buildBullConnectionOptions(
  redisCfg: RedisCacheConfig,
  clientName: string,
): RedisOptions {
  const retryStrategy = buildRetryStrategy(
    redisCfg.retryBaseDelayMs,
    redisCfg.retryMaxDelayMs,
    redisCfg.maxReconnectAttempts,
  );
  const base: RedisOptions = {
    db: redisCfg.db,
    connectionName: `${clientName}-bull`,
    ...(redisCfg.password ? { password: redisCfg.password } : {}),
    connectTimeout: redisCfg.connectTimeoutMs,
    ...(redisCfg.keepAliveMs > 0 ? { keepAlive: redisCfg.keepAliveMs } : {}),
    maxRetriesPerRequest: null,
    retryStrategy,
    reconnectOnError: shouldReconnectOnRedisError,
  };

  if (redisCfg.mode === 'sentinel') {
    return {
      ...base,
      sentinels: redisCfg.sentinels.map((s) => ({ host: s.host, port: s.port })),
      name: redisCfg.sentinelMasterName,
      role: redisCfg.sentinelRole,
      failoverDetector: true,
      ...(redisCfg.sentinelPassword ? { sentinelPassword: redisCfg.sentinelPassword } : {}),
      sentinelRetryStrategy: retryStrategy,
    };
  }

  return {
    ...base,
    host: redisCfg.host,
    port: redisCfg.port,
  };
}

/**
 * Prefix BullMQ: trên Redis Cluster bắt buộc bọc hash tag `{...}` để tránh lỗi `CROSSSLOT`
 * khi BullMQ chạy Lua scripts trên nhiều key cùng queue.
 */
export function formatBullPrefix(prefix: string, mode: RedisHaMode): string {
  const raw = `${prefix}bull`;
  if (mode !== 'cluster') return raw;
  if (raw.includes('{') && raw.includes('}')) return raw;
  return `{${raw}}`;
}
