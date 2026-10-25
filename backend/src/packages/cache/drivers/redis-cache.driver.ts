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

  /** Đảm bảo kết nối tới dịch vụ đã sẵn sàng trước khi thực thi */
  private ensureReady(): void {
    if (!this.redis.isReady()) throw new CacheUnavailableError(this.redis.client.status);
  }

  /** Lấy dữ liệu hoặc đối tượng theo khóa định danh */
  public async get(key: string): Promise<CacheReadResult> {
    this.ensureReady();
    const raw = await this.redis.client.get(this.keys.data(key));
    if (raw === null) return { found: false, value: null };
    return { found: true, value: JSON.parse(raw) as unknown };
  }

  /** Lưu trữ một giá trị theo khóa định danh */
  public async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.ensureReady();
    const raw = JSON.stringify(value ?? null);
    if (ttlSeconds > 0)
      await this.redis.client.set(this.keys.data(key), raw, 'PX', Math.round(ttlSeconds * 1000));
    else await this.redis.client.set(this.keys.data(key), raw);
  }

  /** Xóa bản ghi khỏi hệ thống theo mã định danh */
  public async delete(key: string): Promise<void> {
    this.ensureReady();
    await this.redis.client.unlink(this.keys.data(key));
  }

  /** Xóa toàn bộ các khóa có tiền tố `prefix` trong vùng cache của core bằng SCAN + UNLINK */
  public async deleteByPrefix(prefix: string): Promise<number> {
    this.ensureReady();
    const cleanPrefix = prefix.trim().replace(/^:+/, '');
    if (!cleanPrefix) return 0;
    const pattern = `${escapeGlob(this.keys.dataPrefix())}${escapeGlob(cleanPrefix)}*`;
    return unlinkMatching(this.redis, pattern, (k) => k.startsWith(cleanPrefix));
  }

  /** Kiểm tra sự tồn tại của một khóa trong bộ lưu trữ */
  public async has(key: string): Promise<boolean> {
    this.ensureReady();
    return (await this.redis.client.exists(this.keys.data(key))) === 1;
  }

  /** Xóa sạch toàn bộ dữ liệu trong bộ lưu trữ */
  public async clear(): Promise<number> {
    this.ensureReady();
    return unlinkMatching(this.redis, `${escapeGlob(this.keys.dataPrefix())}*`);
  }
}

/** Thoát các ký tự đặc biệt trong mẫu glob pattern */
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
  /** Đóng và dọn sạch các tác vụ trong hàng đợi khi kết thúc */
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
