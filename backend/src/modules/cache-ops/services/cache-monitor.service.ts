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
  CacheConnectionService,
  CacheMonitoringService,
  recordCacheEvent,
  type CacheClient,
  type KeyspaceSnapshot,
  type ServerInfo,
} from '@packages/cache/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { round } from '@modules/performance/index.js';
import { CacheMetricsService, hitRate } from './cache-metrics.service.js';
import { CacheStoreService } from './cache-store.service.js';
import {
  diffCacheAlerts,
  evaluateCacheRules,
  type CacheRuleInput,
  type CacheViolation,
} from './cache-rules.js';

const TICK_MS = 30_000;
/** Baseline hit/miss = 60 phút trước 5 phút gần nhất (đọc lại từ Prometheus). */
const BASELINE_MIN = 60;
const BASELINE_OFFSET_MIN = 5;

interface Collected {
  keyspace: KeyspaceSnapshot | null;
  server: ServerInfo | null;
  clients: CacheClient[] | null;
  evictionsPerMin: number | null;
  rejectedDelta: number | null;
  /** Lượt đọc (hit + miss) toàn server từ lần tick trước — delta `INFO keyspace_hits/misses`. */
  reads: { hits: number; misses: number } | null;
}

/** Hạn mức bộ nhớ và % sử dụng: maxmemory của server (so với used) hoặc hạn mức cấu hình (so với cache). */
export function memoryUsage(
  server: Pick<ServerInfo, 'usedMemory' | 'maxMemory'> | null,
  cacheBytes: number | null,
  limitMb: number,
) {
  if (server?.maxMemory && server.usedMemory !== null)
    return {
      limitBytes: server.maxMemory,
      source: 'maxmemory' as const,
      percent: round((server.usedMemory / server.maxMemory) * 100, 1),
    };
  if (limitMb > 0 && cacheBytes !== null) {
    const limitBytes = limitMb * 1024 * 1024;
    return {
      limitBytes,
      source: 'config' as const,
      percent: round((cacheBytes / limitBytes) * 100, 1),
    };
  }
  return { limitBytes: null, source: null, percent: null };
}

/**
 * Chạy nền trong API (một instance mỗi chu kỳ nhờ lock Redis): quét keyspace của cache, đọc INFO của Redis,
 * ghi gauge Prometheus (lịch sử biểu đồ), đánh giá cảnh báo và ghi sự kiện bắt đầu / hồi phục.
 */
@Injectable()
export class CacheMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('CacheMonitor');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly connection: CacheConnectionService,
    private readonly monitoring: CacheMonitoringService,
    private readonly metrics: CacheMetricsService,
    private readonly store: CacheStoreService,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
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

  /** Một chu kỳ (public để test). */
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
      const collected = this.monitoring.usable() ? await this.collect(now) : null;
      await this.evaluate(collected, now);
    } catch (err) {
      this.logger.warn(
        `Cache monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async collect(now: number): Promise<Collected> {
    const keyspace = await this.monitoring.refreshKeyspace().catch(() => null);

    const out: Collected = {
      keyspace,
      server: null,
      clients: null,
      evictionsPerMin: null,
      rejectedDelta: null,
      reads: null,
    };
    if (!this.monitoring.supports('serverStats')) {
      this.metrics.record(null, keyspace);
      return out;
    }

    out.server = await this.monitoring.provider.serverInfo().catch(() => null);
    out.clients = await this.monitoring.provider.clients().catch(() => null);
    const s = out.server;
    this.metrics.record(s, keyspace);
    if (s) {
      const prev = await this.store.serverCounters().catch(() => null);
      // Server khởi động lại (uptime giảm) → bộ đếm reset, bỏ qua delta lần này.
      const restarted =
        prev?.uptimeSec != null && s.uptimeSec != null && s.uptimeSec < prev.uptimeSec;
      const delta = (cur: number | null, old: number | null | undefined) =>
        prev && !restarted && cur !== null && old != null && cur >= old ? cur - old : null;
      const evicted = delta(s.evictedKeys, prev?.evicted);
      const rejected = delta(s.rejectedConnections, prev?.rejected);
      const hits = delta(s.keyspaceHits, prev?.hits);
      const misses = delta(s.keyspaceMisses, prev?.misses);
      out.reads = hits !== null && misses !== null ? { hits, misses } : null;
      const minutes = prev ? Math.max(1 / 60, (now - prev.at) / 60_000) : null;
      out.evictionsPerMin = evicted !== null && minutes ? round(evicted / minutes, 2) : null;
      out.rejectedDelta = rejected;
      await this.store.setServerCounters({
        at: now,
        evicted: s.evictedKeys,
        expired: s.expiredKeys,
        rejected: s.rejectedConnections,
        hits: s.keyspaceHits,
        misses: s.keyspaceMisses,
        uptimeSec: s.uptimeSec,
      });
    }
    return out;
  }

  private async evaluate(c: Collected | null, now: number): Promise<void> {
    const [base, active] = await Promise.all([
      this.metrics.stats(BASELINE_MIN, BASELINE_OFFSET_MIN),
      this.store.activeAlerts(),
    ]);
    const cfg = this.config.cache;
    const reads = c?.reads ?? null;
    const total = reads ? reads.hits + reads.misses : 0;
    const curHit = reads ? hitRate(reads.hits, total) : null;
    const curMiss = reads && total ? round((reads.misses / total) * 100, 2) : null;
    const ks = c?.keyspace ?? null;
    const topPersistent = ks?.namespaces
      .filter((n) => n.persistent > 0)
      .sort((a, b) => b.persistent - a.persistent)[0];
    const largest = ks?.largestKeys[0] ?? null;

    const input: CacheRuleInput = {
      connection: this.connection.getStatus().state,
      hitRate: { current: curHit, baseline: base.hitRatePercent, reads: total },
      missRate: {
        current: curMiss,
        baseline: (base.reads ?? 0) >= cfg.rules.minReads ? base.missRatePercent : null,
      },
      memory: {
        percent: memoryUsage(c?.server ?? null, ks?.totalBytes ?? null, cfg.memoryLimitMb).percent,
      },
      evictionsPerMin: c?.evictionsPerMin ?? null,
      rejectedDelta: c?.rejectedDelta ?? null,
      connections: {
        used: c?.server?.connectedClients ?? null,
        max: c?.server?.maxClients ?? null,
      },
      expiringNext60s: ks?.expiringNext60s ?? null,
      largestKey: largest ? { key: largest.key, bytes: largest.bytes } : null,
      persistent:
        ks && ks.persistent > 0
          ? {
              keys: ks.persistent,
              // Namespace session/nhạy cảm vẫn tính; chỉ để gợi ý chỗ xem.
              topNamespace: topPersistent?.name ?? null,
            }
          : null,
    };
    const violations = evaluateCacheRules(input, cfg.rules);
    await this.applyAlerts(violations, active, now);
  }

  private async applyAlerts(
    violations: CacheViolation[],
    active: Awaited<ReturnType<CacheStoreService['activeAlerts']>>,
    now: number,
  ): Promise<void> {
    const { started, set, recovered } = diffCacheAlerts(violations, active, now);
    const key = this.store.keys.activeAlerts();
    const pipe = this.store.client.pipeline();
    for (const [id, state] of set) pipe.hset(key, id, JSON.stringify(state));
    if (recovered.length) pipe.hdel(key, ...recovered.map((r) => r.id));
    await pipe.exec();
    const runtime = this.identity?.id ?? null;
    // Cảnh báo mức info (key không TTL…) không cần vào timeline mỗi lần.
    for (const v of started.filter((x) => x.severity !== 'info'))
      await recordCacheEvent(this.redis, {
        type: 'alert_started',
        severity: v.severity,
        params: {
          rule: v.rule,
          value: v.value,
          threshold: v.threshold,
          unit: v.unit,
          namespace: v.namespace ?? '',
          ...v.extra,
        },
        runtime,
        at: now,
      });
    for (const r of recovered.filter((x) => x.alert.severity !== 'info'))
      await recordCacheEvent(this.redis, {
        type: 'alert_recovered',
        severity: 'success',
        params: {
          rule: r.alert.rule,
          namespace: r.alert.namespace ?? '',
          minutes: Math.max(1, Math.round(r.durationMs / 60_000)),
        },
        runtime,
        at: now,
      });
  }
}
