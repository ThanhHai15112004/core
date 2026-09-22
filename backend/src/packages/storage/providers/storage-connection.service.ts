import { performance } from 'node:perf_hooks';
import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import type {
  StorageConnectionState,
  StorageConnectionStatus,
} from '../contracts/storage-events.types.js';
import { LocalStorageDriver } from '../drivers/local-storage.driver.js';
import { recordStorageEvent } from '../utils/storage-events.js';
import { sanitizeStorageMessage, storageErrorCode } from '../utils/storage-errors.js';
import { BaseStorageProvider } from './storage.provider.js';

const CHECK_MS = 30_000;
/** Số lần kiểm tra lỗi liên tiếp trước khi coi là "không khả dụng". */
const UNAVAILABLE_AFTER = 3;
const BOOT_CHECK_MS = 3000;

/**
 * Trạng thái kết nối tới storage backend: kiểm tra định kỳ (local: quyền đọc/ghi root; S3: HeadBucket),
 * ghi sự kiện mất/khôi phục kết nối (chỉ runtime API ghi để không lặp).
 */
@Injectable()
export class StorageConnectionService implements OnApplicationBootstrap, OnModuleDestroy {
  private state: StorageConnectionState = 'connecting';
  private since = Date.now();
  private lastSuccessAt: number | null = null;
  private lastPingMs: number | null = null;
  private lastError: string | null = null;
  private failures = 0;
  private lostAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly storage: BaseStorageProvider,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {}

  /** Chờ lần kiểm tra đầu (tối đa BOOT_CHECK_MS) để trạng thái xác định ngay khi app sẵn sàng. */
  public async onApplicationBootstrap(): Promise<void> {
    await Promise.race([this.check(), new Promise((r) => setTimeout(r, BOOT_CHECK_MS).unref())]);
    if (this.config.isTest) return;
    this.timer = setInterval(() => void this.check(), CHECK_MS);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private set(state: StorageConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.since = Date.now();
  }

  /** Kiểm tra ngay (public cho Test Storage/overview). */
  public async check(): Promise<StorageConnectionStatus> {
    const started = performance.now();
    try {
      await this.storage.driver.ping();
      this.markSuccess(Number((performance.now() - started).toFixed(2)));
    } catch (err) {
      this.markFailure(err);
    }
    return this.getStatus();
  }

  public markSuccess(pingMs: number | null = null): void {
    const now = Date.now();
    if (pingMs !== null) this.lastPingMs = pingMs;
    this.lastSuccessAt = now;
    this.failures = 0;
    this.lastError = null;
    this.set('connected');
    if (this.lostAt === null) return;
    const lostAt = this.lostAt;
    this.lostAt = null;
    if (this.identity?.id !== 'api') return;
    void recordStorageEvent(this.redis, {
      type: 'connection_recovered',
      severity: 'success',
      params: { seconds: Math.max(1, Math.round((now - lostAt) / 1000)) },
      runtime: this.identity.id,
      at: now,
    });
  }

  private markFailure(err: unknown): void {
    const root =
      this.storage.driver instanceof LocalStorageDriver ? this.storage.driver.root : undefined;
    const code = storageErrorCode(err);
    this.lastError = `${code ? `${code}: ` : ''}${sanitizeStorageMessage(err, root)}`;
    this.failures++;
    const wasUp = this.state === 'connected';
    this.set(
      this.failures >= UNAVAILABLE_AFTER || !this.lastSuccessAt ? 'unavailable' : 'reconnecting',
    );
    if (wasUp) {
      this.lostAt = Date.now();
      if (this.identity?.id === 'api')
        void recordStorageEvent(this.redis, {
          type: 'connection_lost',
          severity: 'critical',
          params: { error: this.lastError },
          runtime: this.identity.id,
        });
    }
  }

  public getStatus(): StorageConnectionStatus {
    return {
      state: this.state,
      since: new Date(this.since).toISOString(),
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastPingMs: this.lastPingMs,
      lastError: this.lastError,
    };
  }
}
