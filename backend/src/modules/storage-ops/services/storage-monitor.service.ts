import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  StorageConnectionService,
  StorageMonitoringService,
  growthSince,
  recordStorageEvent,
  type MultipartUpload,
  type UsageSnapshot,
} from '@packages/storage/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { round } from '@modules/performance/index.js';
import { StorageStoreService } from './storage-store.service.js';
import { diffStorageAlerts, evaluateStorageRules, type StorageViolation } from './storage-rules.js';

const TICK_MS = 60_000;
/** Quét usage (có thể nặng với bucket lớn) mỗi 5 phút; các chu kỳ khác dùng snapshot đã lưu. */
const USAGE_EVERY_MS = 5 * 60_000;
const DAY = 86_400_000;

export const capacityPercent = (used: number | null, total: number | null) =>
  used !== null && total ? round((used / total) * 100, 1) : null;

/** Multipart upload dở quá `staleMin` phút. */
export const staleOf = (uploads: MultipartUpload[], staleMin: number, now: number) =>
  uploads.filter((u) => u.initiated !== null && now - u.initiated >= staleMin * 60_000);

/**
 * Chạy nền trong API (một instance mỗi chu kỳ nhờ lock Redis): quét usage định kỳ (lịch sử tăng trưởng),
 * ghi gauge dung lượng/số object/upload đang chạy, và đánh giá cảnh báo.
 */
@Injectable()
export class StorageMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('StorageMonitor');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly connection: StorageConnectionService,
    private readonly monitoring: StorageMonitoringService,
    private readonly store: StorageStoreService,
    private readonly config: CoreConfigService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
    @Optional() private readonly redis?: RedisService,
  ) {}

  public onApplicationBootstrap(): void {
    if (this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 5000).unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(now = Date.now()): Promise<void> {
    if (this.running || !this.store.isAvailable()) return;
    this.running = true;
    try {
      const locked = await this.store.client.set(
        this.store.keys.collectLock(),
        String(now),
        'PX',
        TICK_MS - 1000,
        'NX',
      );
      if (locked !== 'OK') return;
      await this.connection.check();
      const usable = this.monitoring.usable();
      let usage = await this.monitoring.storedUsage().catch(() => null);
      if (usable && (!usage || now - usage.at >= USAGE_EVERY_MS))
        usage = await this.monitoring.refreshUsage(now).catch((err) => {
          this.logger.warn(`Storage usage scan failed: ${this.monitoring.errorMessage(err)}`);
          return usage;
        });
      const multipart =
        usable && this.monitoring.supports('multipart')
          ? await this.monitoring.provider.multipart().catch(() => null)
          : null;
      await this.evaluate(usage, multipart, now);
    } catch (err) {
      this.logger.warn(
        `Storage monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async evaluate(
    usage: UsageSnapshot | null,
    multipart: MultipartUpload[] | null,
    now: number,
  ): Promise<void> {
    const cfg = this.config.storage;
    const [active, capacity, points] = await Promise.all([
      this.store.activeAlerts(),
      this.monitoring.usable()
        ? this.monitoring.provider.capacity().catch(() => null)
        : Promise.resolve(null),
      this.monitoring.points(8 * 24 + 1).catch(() => []),
    ]);
    const current = usage ? { bytes: usage.totalBytes, objects: usage.totalObjects } : null;
    const last24h = current ? growthSince(points, current, now - DAY) : null;
    const week = current ? growthSince(points, current, now - 8 * DAY) : null;
    const dayAgo = points.find((p) => p.at <= now - DAY);
    // Mức tăng trung bình/ngày của 7 ngày trước 24h gần nhất.
    const avgDaily7d =
      week && last24h && dayAgo && week.from < dayAgo.at
        ? (week.bytes - last24h.bytes) / Math.max(1, (dayAgo.at - week.from) / DAY)
        : null;
    let topContainer: string | null = null;
    let topContainerBytes: number | null = null;
    if (usage && dayAgo)
      for (const c of usage.containers) {
        const delta = c.bytes - (dayAgo.containers[c.name]?.bytes ?? 0);
        if (topContainerBytes === null || delta > topContainerBytes) {
          topContainer = c.name;
          topContainerBytes = delta;
        }
      }
    const stale = multipart ? staleOf(multipart, cfg.staleUploadMin, now) : null;
    const violations = evaluateStorageRules(
      {
        connection: this.connection.getStatus().state,
        capacityPercent: capacityPercent(
          capacity?.source === 'filesystem' &&
            capacity.totalBytes !== null &&
            capacity.freeBytes !== null
            ? capacity.totalBytes - capacity.freeBytes
            : (usage?.totalBytes ?? null),
          capacity?.totalBytes ?? null,
        ),
        growth: { last24h: last24h?.bytes ?? null, avgDaily7d, topContainer, topContainerBytes },
        staleMultipart: stale
          ? { count: stale.length, bytes: stale.reduce((s, u) => s + (u.uploadedBytes ?? 0), 0) }
          : null,
        largestObject: usage?.largest[0]
          ? { key: usage.largest[0].key, size: usage.largest[0].size }
          : null,
      },
      { ...cfg.rules, largeObjectBytes: cfg.largeObjectMb * 1024 * 1024 },
    );
    await this.applyAlerts(violations, active, now);
  }

  private async applyAlerts(
    violations: StorageViolation[],
    active: Awaited<ReturnType<StorageStoreService['activeAlerts']>>,
    now: number,
  ): Promise<void> {
    const { started, set, recovered } = diffStorageAlerts(violations, active, now);
    const key = this.store.keys.activeAlerts();
    const pipe = this.store.client.pipeline();
    for (const [id, state] of set) pipe.hset(key, id, JSON.stringify(state));
    if (recovered.length) pipe.hdel(key, ...recovered.map((r) => r.id));
    await pipe.exec();
    const runtime = this.identity?.id ?? null;
    for (const v of started.filter((x) => x.severity !== 'info'))
      await recordStorageEvent(this.redis, {
        type: 'alert_started',
        severity: v.severity,
        params: { rule: v.id, value: v.value, threshold: v.threshold, unit: v.unit, ...v.extra },
        runtime,
        at: now,
      });
    for (const r of recovered.filter((x) => x.alert.severity !== 'info'))
      await recordStorageEvent(this.redis, {
        type: 'alert_recovered',
        severity: 'success',
        params: { rule: r.id, minutes: Math.max(1, Math.round(r.durationMs / 60_000)) },
        runtime,
        at: now,
      });
  }
}
