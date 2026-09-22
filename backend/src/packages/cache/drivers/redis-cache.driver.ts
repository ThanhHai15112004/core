import type { RedisService } from '@packages/redis/index.js';
import { cacheKeys } from '../constants/cache.keys.js';
import { CacheUnavailableError, type CacheDriver, type CacheReadResult } from './cache-driver.js';

const SCAN_COUNT = 500;
const UNLINK_BATCH = 500;

/**
 * Cache dùng chung giữa các runtime, key `<REDIS_PREFIX>cache:<key>`, value là JSON.
 * Redis dùng chung với project khác nên không bao giờ dùng KEYS/FLUSHDB — xoá hàng loạt bằng SCAN + UNLINK
 * và chỉ trong vùng `cache:` của core.
 */
export class RedisCacheDriver implements CacheDriver {
  public readonly name = 'redis' as const;
  private readonly keys: ReturnType<typeof cacheKeys>;

  constructor(private readonly redis: RedisService) {
    this.keys = cacheKeys(redis);
  }

  private ensureReady(): void {
    if (!this.redis.isReady()) throw new CacheUnavailableError(this.redis.client.status);
  }

  public async get(key: string): Promise<CacheReadResult> {
    this.ensureReady();
    const raw = await this.redis.client.get(this.keys.data(key));
    if (raw === null) return { found: false, value: null };
    return { found: true, value: JSON.parse(raw) as unknown };
  }

  public async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.ensureReady();
    const raw = JSON.stringify(value ?? null);
    if (ttlSeconds > 0)
      await this.redis.client.set(this.keys.data(key), raw, 'PX', Math.round(ttlSeconds * 1000));
    else await this.redis.client.set(this.keys.data(key), raw);
  }

  public async delete(key: string): Promise<void> {
    this.ensureReady();
    await this.redis.client.unlink(this.keys.data(key));
  }

  public async has(key: string): Promise<boolean> {
    this.ensureReady();
    return (await this.redis.client.exists(this.keys.data(key))) === 1;
  }

  public async clear(): Promise<number> {
    this.ensureReady();
    return unlinkMatching(this.redis, `${escapeGlob(this.keys.dataPrefix())}*`);
  }
}

export const escapeGlob = (s: string) => s.replace(/[*?[\]\\]/g, '\\$&');

/**
 * Xoá mọi key khớp `pattern` bằng SCAN + UNLINK theo lô (không chặn Redis như KEYS/DEL hàng loạt).
 * `guard` kiểm lại từng key trước khi xoá (phòng pattern sai).
 */
export async function unlinkMatching(
  redis: RedisService,
  pattern: string,
  guard: (key: string) => boolean = () => true,
): Promise<number> {
  const prefix = cacheKeys(redis).dataPrefix();
  let cursor = '0';
  let deleted = 0;
  let batch: string[] = [];
  const drain = async () => {
    if (batch.length === 0) return;
    deleted += await redis.client.unlink(...batch);
    batch = [];
  };
  do {
    const [next, keys] = await redis.client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT);
    cursor = next;
    for (const k of keys) {
      // Tuyệt đối không xoá ngoài vùng cache của core.
      if (!k.startsWith(prefix) || !guard(k.slice(prefix.length))) continue;
      batch.push(k);
      if (batch.length >= UNLINK_BATCH) await drain();
    }
  } while (cursor !== '0');
  await drain();
  return deleted;
}
