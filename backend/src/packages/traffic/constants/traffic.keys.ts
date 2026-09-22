import type { RedisService } from '@packages/redis/index.js';
import type { TrafficTier } from '../contracts/traffic.types.js';

/** Tất cả key Redis của HTTP traffic (đã có REDIS_PREFIX). */
export const trafficKeys = (redis: RedisService) => ({
  /** Hash aggregate của một bucket thời gian cho một instance. */
  bucket: (tier: TrafficTier, bucketStartSec: number, instance: string) =>
    redis.key('traffic', 'b', tier, String(bucketStartSec), instance),
  /** Hash routeId → TrafficRoute (JSON). */
  routes: () => redis.key('traffic', 'routes'),
  /** ZSET instance → lần cuối ghi (epoch ms). */
  instances: () => redis.key('traffic', 'instances'),
  requestLog: () => redis.key('traffic', 'req', 'log'),
  requestDetail: (id: string) => redis.key('traffic', 'req', id),
  active: (instance: string) => redis.key('traffic', 'active', instance),
});

/** Bản chi tiết request giữ 24h. */
export const REQUEST_DETAIL_TTL_SEC = 24 * 3600;
/** Field aggregate trong hash bucket: `<routeId>|<metric>`. */
export const FIELD_SEPARATOR = '|';
/** Field peak active request của bucket. */
export const PEAK_ACTIVE_FIELD = '_pa';
