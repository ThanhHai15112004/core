import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import type {
  CacheConnectionState,
  CacheConnectionStatus,
} from '../contracts/cache-events.types.js';
import { recordCacheEvent } from '../utils/cache-events.js';
import { BaseCacheProvider } from './cache.provider.js';

/**
 * Trạng thái kết nối của backend cache. Driver redis: theo dõi sự kiện của client ioredis (tự kết nối lại),
 * ghi sự kiện mất/khôi phục kết nối (chỉ runtime API ghi để không lặp 3 lần). Driver memory: luôn sẵn sàng.
 */
@Injectable()
export class CacheConnectionService implements OnApplicationBootstrap, OnModuleDestroy {
  private state: CacheConnectionState = 'connecting';
  private since = Date.now();
  private lastSuccessAt: number | null = null;
  private lostAt: number | null = null;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly cache: BaseCacheProvider,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {}

  private get usesRedis(): boolean {
    return this.cache.driver.name === 'redis' && Boolean(this.redis);
  }

  public onApplicationBootstrap(): void {
    if (!this.usesRedis || !this.redis) {
      this.set('connected');
      this.lastSuccessAt = Date.now();
      return;
    }
    const client = this.redis.client;
    if (this.redis.isReady()) this.onReady();
    const on = (event: string, fn: () => void) => {
      client.on(event, fn);
      this.off.push(() => client.off(event, fn));
    };
    on('ready', () => this.onReady());
    on('close', () => this.onLost());
    on('reconnecting', () => this.set(this.lastSuccessAt ? 'reconnecting' : 'connecting'));
    on('end', () => this.set('unavailable'));
  }

  public onModuleDestroy(): void {
    this.off.forEach((f) => f());
    this.off.length = 0;
  }

  private set(state: CacheConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.since = Date.now();
  }

  private onReady(): void {
    const now = Date.now();
    this.set('connected');
    this.lastSuccessAt = now;
    if (this.lostAt === null) return;
    const lostAt = this.lostAt;
    this.lostAt = null;
    // Lúc mất kết nối không ghi được vào Redis → ghi cả hai sự kiện khi đã khôi phục.
    if (this.identity?.id !== 'api') return;
    void recordCacheEvent(this.redis, {
      type: 'connection_lost',
      severity: 'critical',
      params: { error: this.redis?.getLastError() ?? '' },
      runtime: this.identity.id,
      at: lostAt,
    }).then(() =>
      recordCacheEvent(this.redis, {
        type: 'connection_recovered',
        severity: 'success',
        params: { seconds: Math.max(1, Math.round((now - lostAt) / 1000)) },
        runtime: this.identity?.id ?? null,
        at: now,
      }),
    );
  }

  private onLost(): void {
    if (this.state === 'connected') {
      this.lostAt = Date.now();
      this.set('reconnecting');
    }
  }

  /** Lệnh thành công từ monitor (PING) — cập nhật lần thành công cuối. */
  public markSuccess(at = Date.now()): void {
    this.lastSuccessAt = at;
  }

  public getStatus(): CacheConnectionStatus {
    if (this.usesRedis && this.redis) {
      // Đồng bộ với trạng thái thật của client (phòng lỡ sự kiện).
      const ready = this.redis.isReady();
      if (ready && this.state !== 'connected') this.onReady();
      if (!ready && this.state === 'connected') this.onLost();
    }
    return {
      state: this.state,
      since: new Date(this.since).toISOString(),
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastError: this.state === 'connected' ? null : (this.redis?.getLastError() ?? null),
    };
  }
}
