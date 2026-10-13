import type { Tone } from '@core/theme';
import type { ChartColor } from '@core/ui/charts';
import type { CacheErrorKind, CacheHealthStatus, CacheMetric, CacheRange, CacheTab, KeyFilter, TtlBucketId } from '../types/cache.types';
import type { TabAlias } from '../shell/useSectionRoute';

/** Tab hiển thị (Cấu hình mở dạng sheet ⚙). */
export const CACHE_TABS = ['overview', 'namespaces', 'keys', 'activity'] as const;
export type CachePageTab = (typeof CACHE_TABS)[number];

/** Tab cũ → tab mới (link cũ, `tab` trong cảnh báo / sự kiện của backend). */
export const CACHE_TAB_ALIASES: Partial<Record<CacheTab, TabAlias<CachePageTab>>> = {
  memory: { tab: 'overview' },
  ttl: { tab: 'overview' },
  connections: { tab: 'overview' },
  events: { tab: 'activity' },
  operations: { tab: 'activity' },
  configuration: { tab: 'overview', query: { settings: '1' } },
};

export const CACHE_RANGES: CacheRange[] = ['15m', '1h', '6h', '24h'];
export const CACHE_METRICS: CacheMetric[] = ['hitRate', 'reads', 'operations', 'memory', 'keys', 'evictions'];
export const TTL_BUCKETS: TtlBucketId[] = ['lt1m', '1to10m', '10to60m', '1to24h', 'gt24h', 'none'];
export const KEY_TYPES = ['string', 'hash', 'list', 'set', 'zset', 'stream'] as const;
export const KEY_TTL_FILTERS: KeyFilter['ttl'][] = ['any', 'expiring', 'persistent', 'lt1m'];
export const CACHE_ERROR_KINDS: CacheErrorKind[] = ['connection', 'timeout', 'command', 'oom', 'serialization'];

/** Số key mỗi lần quét (SCAN theo cursor). */
export const KEY_PAGE_SIZE = 100;
/** TTL còn dưới mức này (ms) → tô cảnh báo. */
export const TTL_SOON_MS = 60_000;
/** Số namespace hiện trên thanh "bộ nhớ theo namespace" (còn lại gộp "Khác"). */
export const NAMESPACE_BAR_LIMIT = 8;
/** Số namespace trên Tổng quan. */
export const TOP_NAMESPACES = 6;
/** Mức % bộ nhớ / kết nối coi là cao (khi backend không gửi ngưỡng riêng). */
export const USAGE_THRESHOLDS = { warn: 70, crit: 85 } as const;
/** Fragmentation ratio của Redis coi là cao. */
export const FRAGMENTATION_WARN = 1.5;
/** Hit rate giảm quá số điểm này so với baseline → tô cảnh báo. */
export const HIT_RATE_DROP_WARN_POINTS = 5;
/** Hit rate dưới (ngưỡng cảnh báo − mức này) → nghiêm trọng. */
export const HIT_RATE_CRIT_GAP = 20;
/** Cửa sổ đánh giá hit rate của backend (phút) — dùng trong câu "chưa đủ dữ liệu". */
export const HIT_RATE_WINDOW_MIN = 5;
/** Chiều cao danh sách hoạt động (px). */
export const ACTIVITY_MAX_HEIGHT_PX = 640;
/** Chiều cao vùng cuộn bảng key (px). */
export const KEY_TABLE_HEIGHT_PX = 620;

/** Môi trường có nhãn dịch sẵn (`ov.env.*`). */
export const KNOWN_ENVIRONMENTS = ['production', 'staging', 'development'];

/** Chữ xác nhận backend yêu cầu. */
export const CACHE_CONFIRM = { deleteKey: 'DELETE', flush: 'FLUSH CACHE' } as const;

export const CACHE_HEALTH_TONE: Record<CacheHealthStatus, Tone> = {
  healthy: 'ok',
  degraded: 'warn',
  reconnecting: 'warn',
  unavailable: 'crit',
  unknown: 'unknown',
};

/** Màu series theo id backend. */
export const CACHE_SERIES_COLOR: Record<string, ChartColor> = {
  hitRate: 'ok',
  hitsPerMin: 'series-1',
  missesPerMin: 'warn',
  opsPerSec: 'series-1',
  errorsPerSec: 'crit',
  cacheBytes: 'series-1',
  serverUsed: 'series-4',
  keys: 'series-1',
  expiring: 'series-2',
  bytes: 'series-2',
  evictedPerMin: 'crit',
  expiredPerMin: 'series-3',
};

/** Rule cảnh báo backend gắn với từng ô số liệu. */
export const KPI_ALERT_RULES = {
  hitRate: ['HIT_RATE_LOW', 'MISS_STORM'],
  memory: ['MEMORY_PRESSURE'],
  evictions: ['EVICTIONS'],
  expired: ['EXPIRY_SPIKE'],
  connections: ['REJECTED_CONNECTIONS', 'CONNECTIONS_HIGH'],
} as const;
