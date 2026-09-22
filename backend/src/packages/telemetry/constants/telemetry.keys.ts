import type { RedisService } from '@packages/redis/index.js';
import type { TelemetryTier } from '../contracts/telemetry.types.js';

/** Key Redis của số đo hiệu năng (đã có REDIS_PREFIX). */
export const telemetryKeys = (redis: RedisService) => ({
  /** Hash aggregate của một bucket thời gian cho một instance (`<runtime>@<host>:<pid>`). */
  bucket: (tier: TelemetryTier, bucketStartSec: number, instance: string) =>
    redis.key('perf', 'b', tier, String(bucketStartSec), instance),
  /** ZSET instance → lần cuối ghi (epoch ms). */
  instances: () => redis.key('perf', 'instances'),
  /** LIST slow query (mới nhất trước). */
  slowQueries: () => redis.key('perf', 'db', 'slow'),
  /** Hash trạng thái pool kết nối DB mới nhất theo instance (JSON). */
  dbPool: () => redis.key('perf', 'db', 'pool'),
  /** LIST sự kiện hiệu năng (bắt đầu/hồi phục nghẽn). */
  events: () => redis.key('perf', 'events'),
  /** Hash ruleKey → trạng thái đang vi phạm (JSON) để biết nghẽn bắt đầu từ lúc nào. */
  activeRules: () => redis.key('perf', 'active'),
  /** Lock để chỉ một instance API đánh giá rule mỗi chu kỳ. */
  evaluateLock: () => redis.key('perf', 'lock', 'evaluate'),
});
