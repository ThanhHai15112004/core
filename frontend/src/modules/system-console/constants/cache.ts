import type { CacheCapability, CacheHealthStatus, CacheMetric, CacheRange, CacheTab, TtlBucketId } from '../types/cache.types';
import type { StatusTone } from '../utils/status-tone';

export const CACHE_TABS: CacheTab[] = ['overview', 'namespaces', 'keys', 'memory', 'ttl', 'connections', 'events', 'operations', 'configuration'];
export const CACHE_RANGES: CacheRange[] = ['15m', '1h', '6h', '24h'];
export const DEFAULT_CACHE_RANGE: CacheRange = '1h';
export const CACHE_METRICS: CacheMetric[] = ['hitRate', 'reads', 'operations', 'memory', 'keys', 'evictions'];
export const TTL_BUCKETS: TtlBucketId[] = ['lt1m', '1to10m', '10to60m', '1to24h', 'gt24h', 'none'];
export const KEY_TYPES = ['string', 'hash', 'list', 'set', 'zset', 'stream'] as const;
export const KEY_PAGE_SIZE = 100;

/** Tab cần capability nào (driver không hỗ trợ → hiện "Không hỗ trợ"). */
export const TAB_CAPABILITY: Partial<Record<CacheTab, CacheCapability>> = {
  keys: 'keyExplorer',
  connections: 'clients',
};

export const CACHE_HEALTH_TONE: Record<CacheHealthStatus, StatusTone> = {
  healthy: 'ok',
  degraded: 'warn',
  reconnecting: 'warn',
  unavailable: 'crit',
  unknown: 'unknown',
};

export const CACHE_SERIES_COLORS: Record<string, string> = {
  hitRate: 'var(--scp-success)',
  hitsPerMin: 'var(--scp-series-1)',
  missesPerMin: 'var(--scp-warning)',
  getsPerSec: 'var(--scp-series-1)',
  setsPerSec: 'var(--scp-series-2)',
  deletesPerSec: 'var(--scp-series-3)',
  errorsPerSec: 'var(--scp-danger)',
  cacheBytes: 'var(--scp-series-1)',
  serverUsed: 'var(--scp-series-4)',
  keys: 'var(--scp-series-1)',
  expiring: 'var(--scp-series-2)',
  bytes: 'var(--scp-series-2)',
  evictedPerMin: 'var(--scp-danger)',
  expiredPerMin: 'var(--scp-series-3)',
};

export const CACHE_CONFIRM = { deleteKey: 'DELETE', flush: 'FLUSH CACHE' } as const;
