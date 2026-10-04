import type { RedisService } from '@packages/redis/index.js';
import { LOGS_STREAM_MAXLEN } from '../constants/logs.keys.js';

const BATCH = 100;
const FLUSH_MS = 500;
/** Redis chậm / mất kết nối: giữ tối đa chừng này dòng, quá thì bỏ (đếm `dropped`). */
const MAX_BUFFER = 5_000;

/**
 * Đích phụ của pino (multistream): gom dòng JSON và ghi theo lô vào Redis Stream
 * `XADD logs:<env> MAXLEN ~ 50000 * d <json>`. Không bao giờ chặn hay làm lỗi luồng ghi log.
 * Một instance mỗi process (pino root là singleton) — `attach()` gắn kết nối Redis khi app khởi động.
 */
export class RedisStreamDestination {
  private buffer: string[] = [];
  private redis: RedisService | null = null;
  private key: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  public dropped = 0;
  public written = 0;
  public lastSuccessAt: number | null = null;
  public lastErrorAt: number | null = null;
  public lastError: string | null = null;

  public attach(redis: RedisService, key: string): void {
    this.redis = redis;
    this.key = key;
  }

  public detach(redis: RedisService): void {
    if (this.redis !== redis) return;
    this.redis = null;
    this.key = null;
    this.buffer = [];
  }

  public write(line: string): void {
    if (!this.redis) return;
    if (this.buffer.length >= MAX_BUFFER) {
      this.dropped++;
      return;
    }
    this.buffer.push(line.trimEnd());
    if (this.buffer.length >= BATCH) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), FLUSH_MS);
      this.timer.unref();
    }
  }

  public async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const redis = this.redis;
    const key = this.key;
    if (this.flushing || !redis || !key || this.buffer.length === 0 || !redis.isReady()) return;
    this.flushing = true;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      const pipe = redis.client.pipeline();
      for (const line of batch)
        pipe.xadd(key, 'MAXLEN', '~', String(LOGS_STREAM_MAXLEN), '*', 'd', line);
      await pipe.exec();
      this.written += batch.length;
      this.lastSuccessAt = Date.now();
    } catch (err) {
      this.dropped += batch.length;
      this.lastErrorAt = Date.now();
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.flushing = false;
    }
  }
}
