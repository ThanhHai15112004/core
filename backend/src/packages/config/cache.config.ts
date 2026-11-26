import { env } from './env.js';

/** Chuyển đổi giá trị sang kiểu số hoặc trả về giá trị mặc định */
const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
/** Chuyển đổi giá trị sang kiểu boolean hoặc trả về giá trị mặc định */
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;
/** Chuyển đổi giá trị sang mảng danh sách hoặc trả về giá trị mặc định */
const listOr = (key: string, fallback: string[]): string[] => {
  const raw = env(key, false);
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

export type CacheDriverName = 'redis' | 'memory';
export type RedisMode = 'standalone' | 'sentinel' | 'cluster';
export type RedisClusterScaleReads = 'master' | 'slave' | 'all';
export type RedisSentinelRole = 'master' | 'slave';

export interface RedisEndpoint {
  host: string;
  port: number;
}

const VALID_REDIS_MODES = new Set<RedisMode>(['standalone', 'sentinel', 'cluster']);
const VALID_CLUSTER_SCALE_READS = new Set<RedisClusterScaleReads>(['master', 'slave', 'all']);
const VALID_SENTINEL_ROLES = new Set<RedisSentinelRole>(['master', 'slave']);

/** Phân tích danh sách endpoint dạng `host:port,host2:port2` cho Sentinel hoặc Cluster. */
export function parseRedisEndpoints(
  raw: string,
  defaultPort: number = 6379,
  envKey: string = 'REDIS_ENDPOINTS',
): RedisEndpoint[] {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.map((entry) => {
    const colonIdx = entry.lastIndexOf(':');
    let host = entry;
    let port = defaultPort;
    if (colonIdx > 0 && !entry.endsWith(']')) {
      host = entry.slice(0, colonIdx).trim();
      const portRaw = entry.slice(colonIdx + 1).trim();
      const parsedPort = Number(portRaw);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        throw new Error(
          `[ConfigError] Biến môi trường [${envKey}] chứa port không hợp lệ: "${entry}"`,
        );
      }
      port = parsedPort;
    }
    host = host.replace(/^\[|\]$/g, '').trim();
    if (!host) {
      throw new Error(`[ConfigError] Biến môi trường [${envKey}] chứa host rỗng: "${entry}"`);
    }
    return { host, port };
  });
}

function resolveRedisMode(): RedisMode {
  const raw = env('REDIS_MODE', false).trim().toLowerCase();
  if (!raw) return 'standalone';
  if (!VALID_REDIS_MODES.has(raw as RedisMode)) {
    throw new Error(
      `[ConfigError] Biến môi trường [REDIS_MODE] không hợp lệ: "${raw}" (chỉ nhận standalone | sentinel | cluster)`,
    );
  }
  return raw as RedisMode;
}

function resolveClusterScaleReads(): RedisClusterScaleReads {
  const raw = env('REDIS_CLUSTER_SCALE_READS', false).trim().toLowerCase();
  if (!raw) return 'master';
  if (!VALID_CLUSTER_SCALE_READS.has(raw as RedisClusterScaleReads)) {
    throw new Error(
      `[ConfigError] Biến môi trường [REDIS_CLUSTER_SCALE_READS] không hợp lệ: "${raw}" (chỉ nhận master | slave | all)`,
    );
  }
  return raw as RedisClusterScaleReads;
}

function resolveSentinelRole(): RedisSentinelRole {
  const raw = env('REDIS_SENTINEL_ROLE', false).trim().toLowerCase();
  if (!raw) return 'master';
  if (!VALID_SENTINEL_ROLES.has(raw as RedisSentinelRole)) {
    throw new Error(
      `[ConfigError] Biến môi trường [REDIS_SENTINEL_ROLE] không hợp lệ: "${raw}" (chỉ nhận master | slave)`,
    );
  }
  return raw as RedisSentinelRole;
}

/** Lấy thông tin cấu hình bộ nhớ đệm */
export const cacheConfig = () => {
  const mode = resolveRedisMode();
  const host =
    mode === 'standalone' ? env('REDIS_HOST') : env('REDIS_HOST', false).trim() || '127.0.0.1';
  const port =
    mode === 'standalone'
      ? env.number('REDIS_PORT')
      : env('REDIS_PORT', false)
        ? env.number('REDIS_PORT')
        : 6379;

  const sentinelsRaw =
    mode === 'sentinel' ? env('REDIS_SENTINELS', true) : env('REDIS_SENTINELS', false);
  const sentinels = sentinelsRaw ? parseRedisEndpoints(sentinelsRaw, 26379, 'REDIS_SENTINELS') : [];
  if (mode === 'sentinel' && sentinels.length === 0) {
    throw new Error(
      '[ConfigError] Biến môi trường [REDIS_SENTINELS] phải chứa ít nhất 1 node Sentinel khi REDIS_MODE=sentinel!',
    );
  }
  const sentinelMasterName =
    mode === 'sentinel'
      ? env('REDIS_SENTINEL_MASTER_NAME', true).trim()
      : env('REDIS_SENTINEL_MASTER_NAME', false).trim() || undefined;
  if (mode === 'sentinel' && !sentinelMasterName) {
    throw new Error(
      '[ConfigError] Biến môi trường [REDIS_SENTINEL_MASTER_NAME] bắt buộc khi REDIS_MODE=sentinel!',
    );
  }

  const clusterNodesRaw =
    mode === 'cluster' ? env('REDIS_CLUSTER_NODES', true) : env('REDIS_CLUSTER_NODES', false);
  const clusterNodes = clusterNodesRaw
    ? parseRedisEndpoints(clusterNodesRaw, 6379, 'REDIS_CLUSTER_NODES')
    : [];
  if (mode === 'cluster' && clusterNodes.length === 0) {
    throw new Error(
      '[ConfigError] Biến môi trường [REDIS_CLUSTER_NODES] phải chứa ít nhất 1 node Cluster khi REDIS_MODE=cluster!',
    );
  }

  const hotKeyWarnRpm = Math.max(1, numberOr('CACHE_HOT_KEY_WARN_RPM', 120));

  return {
    redis: {
      mode,
      host,
      port,
      prefix: env('REDIS_PREFIX'),
      password: env('REDIS_PASSWORD', false) || undefined,
      db: env.number('REDIS_DB', false),
      sentinels,
      sentinelMasterName,
      sentinelPassword: env('REDIS_SENTINEL_PASSWORD', false) || undefined,
      sentinelRole: resolveSentinelRole(),
      clusterNodes,
      clusterScaleReads: resolveClusterScaleReads(),
      clusterSlotsRefreshTimeoutMs: Math.max(
        200,
        numberOr('REDIS_CLUSTER_SLOTS_REFRESH_TIMEOUT_MS', 2000),
      ),
      clusterSlotsRefreshIntervalMs: Math.max(
        500,
        numberOr('REDIS_CLUSTER_SLOTS_REFRESH_INTERVAL_MS', 5000),
      ),
      connectTimeoutMs: Math.max(200, numberOr('REDIS_CONNECT_TIMEOUT_MS', 5000)),
      commandTimeoutMs: Math.max(100, numberOr('REDIS_COMMAND_TIMEOUT_MS', 3000)),
      keepAliveMs: Math.max(0, numberOr('REDIS_KEEP_ALIVE_MS', 30_000)),
      maxRetriesPerRequest: Math.max(0, numberOr('REDIS_MAX_RETRIES_PER_REQUEST', 1)),
      retryBaseDelayMs: Math.max(50, numberOr('REDIS_RETRY_BASE_DELAY_MS', 500)),
      retryMaxDelayMs: Math.max(100, numberOr('REDIS_RETRY_MAX_DELAY_MS', 5000)),
      maxReconnectAttempts: Math.max(0, numberOr('REDIS_MAX_RECONNECT_ATTEMPTS', 0)),
    },
    /** `redis`: dùng chung giữa các runtime (key `<prefix>cache:*`); `memory`: Map riêng từng process. */
    driver: (env('CACHE_DRIVER', false) === 'memory' ? 'memory' : 'redis') as CacheDriverName,
    /** Chỉ bật `true` khi chủ đích triển khai đơn node (1 server nhỏ) dùng memory cache ở production. */
    allowMemoryInProduction: booleanOr('CACHE_ALLOW_MEMORY_IN_PRODUCTION', false),
    /** TTL mặc định khi `set()` không truyền TTL; 0 = không hết hạn. */
    defaultTtlSec: numberOr('CACHE_DEFAULT_TTL_SEC', 0),
    /** Số segment tối đa của namespace (`data:users:12` → `data:users`). */
    namespaceDepth: Math.max(1, numberOr('CACHE_NAMESPACE_DEPTH', 2)),
    /** Giới hạn số key quét mỗi lần chụp keyspace (SCAN) để không đè nặng Redis. */
    scanMaxKeys: Math.max(100, numberOr('CACHE_SCAN_MAX_KEYS', 100_000)),
    /** Hạn mức bộ nhớ dành cho cache (MB) khi Redis không đặt maxmemory; 0 = không biết. */
    memoryLimitMb: numberOr('CACHE_MEMORY_LIMIT_MB', 0),
    /** Namespace chứa session/token — không bao giờ xem value, cảnh báo khi flush. */
    sessionNamespaces: listOr('CACHE_SESSION_NAMESPACES', ['auth:session', 'session']),
    /** Namespace nhạy cảm khác: value luôn ẩn. */
    sensitiveNamespaces: listOr('CACHE_SENSITIVE_NAMESPACES', ['token', 'otp', 'password', 'auth']),
    degraded: {
      failureThreshold: Math.max(1, numberOr('CACHE_DEGRADED_FAILURE_THRESHOLD', 3)),
      cooldownMs: Math.max(500, numberOr('CACHE_DEGRADED_COOLDOWN_MS', 5000)),
    },
    lock: {
      allowMemoryFallback: booleanOr('REDIS_LOCK_ALLOW_MEMORY_FALLBACK', false),
    },
    hotKeys: {
      windowSec: Math.max(10, numberOr('CACHE_HOT_KEY_WINDOW_SEC', 60)),
      warnRpm: hotKeyWarnRpm,
      maxTrackedKeys: Math.max(100, numberOr('CACHE_HOT_KEY_MAX_TRACKED', 2000)),
    },
    rules: {
      hitRateWarnPercent: numberOr('CACHE_HIT_RATE_WARN_PERCENT', 80),
      /** Miss rate cao hơn baseline (60 phút trước) từ chừng này điểm % trở lên → cảnh báo miss storm. */
      hitRateDropPoints: numberOr('CACHE_HIT_RATE_DROP_POINTS', 15),
      /** Số lượt đọc tối thiểu trong cửa sổ để đánh giá hit rate. */
      minReads: numberOr('CACHE_HIT_RATE_MIN_READS', 50),
      memoryWarnPercent: numberOr('CACHE_MEMORY_WARN_PERCENT', 80),
      memoryCritPercent: numberOr('CACHE_MEMORY_CRIT_PERCENT', 90),
      /** Số key hết hạn trong 60s tới ≥ ngưỡng → nguy cơ cache stampede. */
      expirySpikeKeys: numberOr('CACHE_EXPIRY_SPIKE_KEYS', 1000),
      largeKeyBytes: numberOr('CACHE_LARGE_KEY_BYTES', 1024 * 1024),
      connectionWarnPercent: numberOr('CACHE_CONNECTION_WARN_PERCENT', 80),
      evictionCritPerMin: Math.max(1, numberOr('CACHE_EVICTION_CRIT_PER_MIN', 100)),
      hotKeyWarnRpm,
    },
    /** Xoá key / clear namespace từ System Console. */
    actionsEnabled: booleanOr('OPS_CACHE_ACTIONS_ENABLED', true),
    /** Flush toàn bộ cache (chỉ key cache của core, không bao giờ FLUSHDB). */
    flushEnabled: booleanOr('OPS_CACHE_FLUSH_ENABLED', false),
    /** Xem trước value (đã che field nhạy cảm, giới hạn kích thước). */
    valuePreview: booleanOr('OPS_CACHE_VALUE_PREVIEW', false),
  };
};

export type CacheConfig = ReturnType<typeof cacheConfig>;
