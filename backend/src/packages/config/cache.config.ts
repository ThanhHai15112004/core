import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;
const listOr = (key: string, fallback: string[]): string[] => {
  const raw = env(key, false);
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

export type CacheDriverName = 'redis' | 'memory';

export const cacheConfig = () => ({
  redis: {
    host: env('REDIS_HOST'),
    port: env.number('REDIS_PORT'),
    prefix: env('REDIS_PREFIX'),
    password: env('REDIS_PASSWORD', false) || undefined,
    db: env.number('REDIS_DB', false),
  },
  /** `redis`: dùng chung giữa các runtime (key `<prefix>cache:*`); `memory`: Map riêng từng process. */
  driver: (env('CACHE_DRIVER', false) === 'memory' ? 'memory' : 'redis') as CacheDriverName,
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
  },
  /** Xoá key / clear namespace từ System Console. */
  actionsEnabled: booleanOr('OPS_CACHE_ACTIONS_ENABLED', true),
  /** Flush toàn bộ cache (chỉ key cache của core, không bao giờ FLUSHDB). */
  flushEnabled: booleanOr('OPS_CACHE_FLUSH_ENABLED', false),
  /** Xem trước value (đã che field nhạy cảm, giới hạn kích thước). */
  valuePreview: booleanOr('OPS_CACHE_VALUE_PREVIEW', false),
});

export type CacheConfig = ReturnType<typeof cacheConfig>;
