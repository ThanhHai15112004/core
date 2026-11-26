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
 * Trạng thái kết nối của backend cache. Driver redis: theo dõi sự kiện của client ioredis (tự kết nối lại)
 * và failover HA, ghi sự kiện mất/khôi phục kết nối & đổi Primary (chỉ runtime API ghi để không lặp).
 * Driver memory: luôn sẵn sàng.
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

  /** Thực thi tác vụ khởi động sau khi toàn bộ ứng dụng hoàn tất bootstrap */
  public onApplicationBootstrap(): void {
    if (!this.usesRedis || !this.redis) {
      this.set('connected');
      this.lastSuccessAt = Date.now();
      return;
    }
    const client = this.redis.client;
    if (this.redis.isReady()) this.onReady();
    /** Đăng ký hàm lắng nghe sự kiện trên Event Emitter */
    const on = (event: string, fn: () => void) => {
      client.on(event, fn);
      this.off.push(() => client.off(event, fn));
    };
    on('ready', () => this.onReady());
    on('close', () => this.onLost());
    on('reconnecting', () => {
      if (this.state === 'connected') this.lostAt = Date.now();
      this.set(this.lastSuccessAt ? 'reconnecting' : 'connecting');
    });
    on('end', () => this.set('unavailable'));

    if (typeof this.redis.onFailover === 'function') {
      const offFailover = this.redis.onFailover((event) => {
        if (this.identity?.id !== 'api') return;
        void recordCacheEvent(this.redis, {
          type: 'failover_detected',
          severity: 'warning',
          params: {
            mode: event.mode,
            reason: event.reason,
            primary: event.currentPrimary ?? 'unknown',
          },
          runtime: this.identity.id,
          at: event.at,
        });
      });
      this.off.push(offFailover);
    }
  }

  /** Dọn dẹp tài nguyên và ngắt kết nối khi module bị hủy */
  public onModuleDestroy(): void {
    this.off.forEach((f) => f());
    this.off.length = 0;
  }

  /** Lưu trữ một giá trị theo khóa định danh */
  private set(state: CacheConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.since = Date.now();
  }

  /** Xử lý sự kiện khi kết nối dịch vụ đã sẵn sàng hoạt động */
  private onReady(): void {
    const now = Date.now();
    const previousLostAt = this.lostAt;
    this.set('connected');
    this.lastSuccessAt = now;
    this.lostAt = null;
    if (previousLostAt !== null && this.identity?.id === 'api') {
      const seconds = Math.max(1, Math.round((now - previousLostAt) / 1000));
      void recordCacheEvent(this.redis, {
        type: 'connection_recovered',
        severity: 'success',
        params: { seconds },
        runtime: this.identity.id,
        at: now,
      });
    }
  }

  /** Xử lý sự kiện khi kết nối dịch vụ bị gián đoạn hoặc mất kết nối */
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

  /** Lấy báo cáo tình trạng hoạt động và các chỉ số của package */
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
