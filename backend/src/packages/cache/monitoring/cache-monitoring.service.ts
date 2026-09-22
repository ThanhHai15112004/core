import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import { cacheKeys } from '../constants/cache.keys.js';
import { MemoryCacheDriver } from '../drivers/memory-cache.driver.js';
import { BaseCacheProvider } from '../providers/cache.provider.js';
import { CacheConnectionService } from '../providers/cache-connection.service.js';
import { sanitizeCacheMessage } from '../utils/cache-errors.js';
import { buildKeyspaceSnapshot, mergeKeyspaceSnapshots } from './keyspace.js';
import { MemoryMonitoringProvider } from './memory-monitoring.provider.js';
import { RedisMonitoringProvider } from './redis-monitoring.provider.js';
import type {
  CacheCapability,
  CacheMonitoringProvider,
  CacheSection,
  KeyspaceSnapshot,
} from './monitoring.types.js';

/** Runtime dùng driver memory publish snapshot của mình mỗi chu kỳ (TTL gấp 3 để runtime tắt tự biến mất). */
const MEMORY_PUBLISH_MS = 30_000;
const MEMORY_SNAPSHOT_TTL_SEC = 90;

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** Đọc số liệu vận hành của cache qua provider theo driver (redis / memory). Mọi lệnh đều chỉ đọc. */
@Injectable()
export class CacheMonitoringService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('CacheMonitoring');
  public readonly provider: CacheMonitoringProvider;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cache: BaseCacheProvider,
    private readonly connection: CacheConnectionService,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly recorder?: MetricRecorder,
  ) {
    const depth = this.config.cache.namespaceDepth;
    const driver = this.cache.driver;
    this.provider =
      driver instanceof MemoryCacheDriver || !this.redis
        ? new MemoryMonitoringProvider(driver as MemoryCacheDriver, depth)
        : new RedisMonitoringProvider(this.redis, depth);
  }

  public onApplicationBootstrap(): void {
    if (this.provider.driver !== 'memory' || !this.recorder?.instance || this.config.isTest) return;
    this.timer = setInterval(() => void this.publishMemorySnapshot(), MEMORY_PUBLISH_MS);
    this.timer.unref();
    void this.publishMemorySnapshot();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public get driver() {
    return this.provider.driver;
  }

  public supports(cap: CacheCapability): boolean {
    return this.provider.capabilities.has(cap);
  }

  /** Backend cache có dùng được ngay lúc này không (driver memory luôn có). */
  public usable(): boolean {
    return this.provider.driver === 'memory' || Boolean(this.redis?.isReady());
  }

  /** Chạy một phần số liệu; lỗi/không hỗ trợ/mất kết nối → lý do, không ném. */
  public async section<T>(
    cap: CacheCapability | null,
    fn: () => Promise<T>,
  ): Promise<CacheSection<T>> {
    if (cap && !this.supports(cap))
      return { available: false, reason: 'unsupported', message: this.provider.driver };
    if (!this.usable())
      return {
        available: false,
        reason: 'disconnected',
        message: this.connection.getStatus().state,
      };
    try {
      return { available: true, data: await fn() };
    } catch (err) {
      return { available: false, reason: 'error', message: sanitizeCacheMessage(err) };
    }
  }

  /** Quét keyspace (SCAN có giới hạn) → snapshot; driver memory gộp thêm snapshot của runtime khác. */
  public async scanKeyspace(now = Date.now()): Promise<KeyspaceSnapshot> {
    const started = Date.now();
    const { keys, total, truncated } = await this.provider.scanAll(this.config.cache.scanMaxKeys);
    const own = buildKeyspaceSnapshot({
      keys,
      total,
      truncated,
      driver: this.provider.driver,
      depth: this.config.cache.namespaceDepth,
      at: now,
      durationMs: Date.now() - started,
    });
    if (this.provider.driver !== 'memory') return own;
    const others = (await this.memorySnapshots()).filter(
      (s) => s.instance !== this.recorder?.instance,
    );
    return mergeKeyspaceSnapshots([own, ...others.map((s) => s.snapshot)], now) ?? own;
  }

  /** Snapshot keyspace do collector nền lưu gần nhất. */
  public async storedKeyspace(): Promise<KeyspaceSnapshot | null> {
    if (!this.redis?.isReady()) return null;
    return parse<KeyspaceSnapshot>(await this.redis.client.get(cacheKeys(this.redis).keyspace()));
  }

  public async storeKeyspace(snapshot: KeyspaceSnapshot): Promise<void> {
    if (!this.redis?.isReady()) return;
    await this.redis.client.set(cacheKeys(this.redis).keyspace(), JSON.stringify(snapshot));
  }

  /** Quét mới rồi lưu (sau thao tác xoá để số liệu cập nhật ngay). */
  public async refreshKeyspace(): Promise<KeyspaceSnapshot> {
    const snapshot = await this.scanKeyspace();
    await this.storeKeyspace(snapshot).catch(() => undefined);
    return snapshot;
  }

  private async memorySnapshots(): Promise<{ instance: string; snapshot: KeyspaceSnapshot }[]> {
    if (!this.redis?.isReady()) return [];
    const keys = cacheKeys(this.redis);
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.client.scan(
        cursor,
        'MATCH',
        keys.memorySnapshotPattern(),
        'COUNT',
        100,
      );
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    if (found.length === 0) return [];
    const raws = await this.redis.client.mget(...found);
    return raws
      .map((raw) => parse<{ instance: string; snapshot: KeyspaceSnapshot }>(raw))
      .filter((x): x is { instance: string; snapshot: KeyspaceSnapshot } => x !== null);
  }

  /** Driver memory: mỗi runtime tự publish snapshot của Map mình (API đọc để gộp). */
  public async publishMemorySnapshot(): Promise<void> {
    const instance = this.recorder?.instance;
    if (!instance || !this.redis?.isReady() || this.provider.driver !== 'memory') return;
    try {
      const { keys, total, truncated } = await this.provider.scanAll(this.config.cache.scanMaxKeys);
      const snapshot = buildKeyspaceSnapshot({
        keys,
        total,
        truncated,
        driver: 'memory',
        depth: this.config.cache.namespaceDepth,
        at: Date.now(),
        durationMs: 0,
      });
      await this.redis.client.set(
        cacheKeys(this.redis).memorySnapshot(instance),
        JSON.stringify({ instance, snapshot }),
        'EX',
        MEMORY_SNAPSHOT_TTL_SEC,
      );
    } catch (err) {
      this.logger.debug(`Memory cache snapshot failed: ${sanitizeCacheMessage(err)}`);
    }
  }
}
