import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { STORAGE_SNAPSHOT_LIMIT, storageKeys } from '../constants/storage.keys.js';
import type { ActiveUpload } from '../contracts/storage-events.types.js';
import { LocalStorageDriver } from '../drivers/local-storage.driver.js';
import { S3StorageDriver } from '../drivers/s3-storage.driver.js';
import { BaseStorageProvider } from '../providers/storage.provider.js';
import { StorageConnectionService } from '../providers/storage-connection.service.js';
import { StorageObjectError, sanitizeStorageMessage } from '../utils/storage-errors.js';
import { LocalMonitoringProvider } from './local-monitoring.provider.js';
import { S3MonitoringProvider } from './s3-monitoring.provider.js';
import { buildUsageSnapshot, toUsagePoint, type UsagePoint, type UsageSnapshot } from './usage.js';
import type {
  StorageCapability,
  StorageMonitoringProvider,
  StorageSection,
} from './monitoring.types.js';

/** Snapshot usage cũ hơn mức này thì quét lại khi đọc (quét lớn nặng — collector nền làm thường xuyên). */
const USAGE_MAX_AGE_MS = 5 * 60_000;
const POINT_EVERY_MS = 60 * 60_000;

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Đọc số liệu vận hành của storage qua provider theo driver (local / S3-compatible). Chỉ đọc. */
@Injectable()
export class StorageMonitoringService {
  public readonly provider: StorageMonitoringProvider;

  constructor(
    private readonly storage: BaseStorageProvider,
    private readonly connection: StorageConnectionService,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
  ) {
    const driver = this.storage.driver;
    this.provider =
      driver instanceof S3StorageDriver
        ? new S3MonitoringProvider(driver, this.config.storage)
        : new LocalMonitoringProvider(driver as LocalStorageDriver);
  }

  public supports(cap: StorageCapability): boolean {
    return this.provider.capabilities.has(cap);
  }

  public usable(): boolean {
    return this.connection.getStatus().state === 'connected';
  }

  public errorMessage(err: unknown): string {
    const root =
      this.storage.driver instanceof LocalStorageDriver ? this.storage.driver.root : undefined;
    return sanitizeStorageMessage(err, root);
  }

  /** Một phần số liệu; lỗi/không hỗ trợ/mất kết nối → lý do, không ném. */
  public async section<T>(
    cap: StorageCapability | null,
    fn: () => Promise<T>,
  ): Promise<StorageSection<T>> {
    if (cap && !this.supports(cap))
      return { available: false, reason: 'unsupported', message: this.provider.info().product };
    if (!this.usable())
      return {
        available: false,
        reason: 'disconnected',
        message: this.connection.getStatus().state,
      };
    try {
      return { available: true, data: await fn() };
    } catch (err) {
      if (err instanceof StorageObjectError && err.code === 'UNSUPPORTED')
        return { available: false, reason: 'unsupported', message: this.provider.info().product };
      return { available: false, reason: 'error', message: this.errorMessage(err) };
    }
  }

  public async scanUsage(now = Date.now()): Promise<UsageSnapshot> {
    const started = Date.now();
    const { objects, total, truncated } = await this.provider.scan(
      this.config.storage.scanMaxObjects,
    );
    return buildUsageSnapshot({
      objects,
      total,
      truncated,
      driver: this.storage.driver.name,
      at: now,
      startOfDay: startOfDay(now),
      durationMs: Date.now() - started,
    });
  }

  public async storedUsage(): Promise<UsageSnapshot | null> {
    if (!this.redis?.isReady()) return null;
    return parse<UsageSnapshot>(await this.redis.client.get(storageKeys(this.redis).usage()));
  }

  /** Quét mới rồi lưu; thêm điểm lịch sử mỗi giờ. */
  public async refreshUsage(now = Date.now()): Promise<UsageSnapshot> {
    const snapshot = await this.scanUsage(now);
    if (this.redis?.isReady()) {
      const keys = storageKeys(this.redis);
      await this.redis.client.set(keys.usage(), JSON.stringify(snapshot));
      const [latest] = await this.points(1);
      if (!latest || now - latest.at >= POINT_EVERY_MS)
        await this.redis.client
          .multi()
          .lpush(keys.snapshots(), JSON.stringify(toUsagePoint(snapshot)))
          .ltrim(keys.snapshots(), 0, STORAGE_SNAPSHOT_LIMIT - 1)
          .exec();
    }
    return snapshot;
  }

  /** Snapshot còn mới hoặc quét lại (khi kết nối được). */
  public async usage(): Promise<UsageSnapshot | null> {
    const stored = await this.storedUsage().catch(() => null);
    if (stored && Date.now() - stored.at <= USAGE_MAX_AGE_MS) return stored;
    if (!this.usable()) return stored;
    return this.refreshUsage().catch(() => stored);
  }

  /** Điểm usage theo giờ (mới nhất trước). */
  public async points(limit = STORAGE_SNAPSHOT_LIMIT): Promise<UsagePoint[]> {
    if (!this.redis?.isReady()) return [];
    const raws = await this.redis.client.lrange(storageKeys(this.redis).snapshots(), 0, limit - 1);
    return raws.map((r) => parse<UsagePoint>(r)).filter((p): p is UsagePoint => p !== null);
  }

  /** Upload đang chạy ở mọi runtime (mỗi runtime tự publish). */
  public async activeUploads(): Promise<ActiveUpload[]> {
    if (!this.redis?.isReady()) return this.storage.activeUploads();
    const keys = storageKeys(this.redis);
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.client.scan(
        cursor,
        'MATCH',
        keys.activePattern(),
        'COUNT',
        100,
      );
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    if (!found.length) return [];
    const raws = await this.redis.client.mget(...found);
    return raws.flatMap((r) => parse<ActiveUpload[]>(r) ?? []);
  }
}
