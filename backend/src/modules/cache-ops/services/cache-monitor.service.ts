import {
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
  namespaceMetric,
  recordCacheEvent,
  type CacheClient,
  type KeyspaceSnapshot,
  type ServerInfo,
} from '@packages/cache/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import { mergedOf, round } from '@modules/performance/index.js';
import { CacheMetricsService, hitRate } from './cache-metrics.service.js';
import { CacheStoreService } from './cache-store.service.js';
import {
  diffCacheAlerts,
  evaluateCacheRules,
  type CacheRuleInput,
  type CacheViolation,
} from './cache-rules.js';

const TICK_MS = 30_000;
const RULE_WINDOW_MS = 5 * 60_000;
/** Baseline = 60 phút trước cửa sổ đánh giá (bucket 1 phút). */
const BASELINE_MS = 60 * 60_000;
/** Số namespace có lịch sử key/dung lượng (theo số key). */
export const NAMESPACE_HISTORY_LIMIT = 50;

interface Collected {
  keyspace: KeyspaceSnapshot | null;
  server: ServerInfo | null;
  clients: CacheClient[] | null;
  evictionsPerMin: number | null;
  rejectedDelta: number | null;
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
 * ghi gauge (key, dung lượng theo namespace, bộ nhớ server, eviction) để có lịch sử, rồi đánh giá cảnh báo.
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
    @Optional() private readonly recorder?: MetricRecorder,
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
    const g = (name: string, v: number | null | undefined) => {
      if (v !== null && v !== undefined) this.recorder?.gauge(name, v, now);
    };
    if (keyspace) {
      g('cache.keys', keyspace.totalKeys);
      g('cache.bytes', keyspace.totalBytes);
      g('cache.expiring', keyspace.expiring);
      g('cache.expiringSoon', keyspace.expiringNext60s);
      for (const ns of keyspace.namespaces.slice(0, NAMESPACE_HISTORY_LIMIT)) {
        g(namespaceMetric(ns.name, 'keys'), ns.keys);
        g(namespaceMetric(ns.name, 'bytes'), ns.bytes);
      }
    }

    const out: Collected = {
      keyspace,
      server: null,
      clients: null,
      evictionsPerMin: null,
      rejectedDelta: null,
    };
    if (!this.monitoring.supports('serverStats')) return out;

    out.server = await this.monitoring.provider.serverInfo().catch(() => null);
    out.clients = await this.monitoring.provider.clients().catch(() => null);
    const s = out.server;
    if (s) {
      g('redis.used', s.usedMemory);
      g('redis.peak', s.peakMemory);
      g('redis.max', s.maxMemory);
      g('redis.frag', s.fragmentationRatio);
      g('redis.clients', s.connectedClients);
      g('redis.blocked', s.blockedClients);
      g('redis.opsps', s.opsPerSec);
      const prev = await this.store.serverCounters().catch(() => null);
      // Server khởi động lại (uptime giảm) → bộ đếm reset, bỏ qua delta lần này.
      const restarted =
        prev?.uptimeSec != null && s.uptimeSec != null && s.uptimeSec < prev.uptimeSec;
      const delta = (cur: number | null, old: number | null | undefined) =>
        prev && !restarted && cur !== null && old != null && cur >= old ? cur - old : null;
      const evicted = delta(s.evictedKeys, prev?.evicted);
      const expired = delta(s.expiredKeys, prev?.expired);
      const rejected = delta(s.rejectedConnections, prev?.rejected);
      if (evicted !== null) this.recorder?.count('redis.evicted', evicted, now);
      if (expired !== null) this.recorder?.count('redis.expired', expired, now);
      if (rejected !== null) this.recorder?.count('redis.rejected', rejected, now);
      const minutes = prev ? Math.max(1 / 60, (now - prev.at) / 60_000) : null;
      out.evictionsPerMin = evicted !== null && minutes ? round(evicted / minutes, 2) : null;
      out.rejectedDelta = rejected;
      await this.store.setServerCounters({
        at: now,
        evicted: s.evictedKeys,
        expired: s.expiredKeys,
        rejected: s.rejectedConnections,
        uptimeSec: s.uptimeSec,
      });
    }
    if (out.clients) g('cache.clients', out.clients.length);
    return out;
  }

  private async evaluate(c: Collected | null, now: number): Promise<void> {
    const [win, base, active] = await Promise.all([
      this.metrics.window(now - RULE_WINDOW_MS, now, now, 's10'),
      this.metrics.window(now - BASELINE_MS - RULE_WINDOW_MS, now - RULE_WINDOW_MS, now, 'm1'),
      this.store.activeAlerts(),
    ]);
    const cur = this.metrics.stats(win);
    const prev = this.metrics.stats(base);
    const cfg = this.config.cache;
    const dbQps = (w: typeof win) => {
      const n = mergedOf(w?.buckets ?? [], 'db.query').n;
      return w && n > 0 ? n / w.seconds : null;
    };
    const ks = c?.keyspace ?? null;
    const topPersistent = ks?.namespaces
      .filter((n) => n.persistent > 0)
      .sort((a, b) => b.persistent - a.persistent)[0];
    const largest = ks?.largestKeys[0] ?? null;

    const input: CacheRuleInput = {
      connection: this.connection.getStatus().state,
      hitRate: { current: cur.hitRatePercent, baseline: prev.hitRatePercent, reads: cur.reads },
      missRate: {
        current: cur.missRatePercent,
        baseline: prev.reads >= cfg.rules.minReads ? prev.missRatePercent : null,
      },
      dbQps: { current: dbQps(win), baseline: dbQps(base) },
      namespaces: [...this.metrics.namespaces(win).entries()].map(([name, n]) => ({
        name,
        reads: n.hits + n.misses,
        hitRate: hitRate(n.hits, n.hits + n.misses),
      })),
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
    for (const v of started) {
      // Thông tin (key không TTL) không cần vào timeline sự kiện mỗi lần.
      if (v.severity === 'info') continue;
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
        runtime: null,
        at: now,
      });
    }
    for (const r of recovered) {
      if (r.alert.severity === 'info') continue;
      await recordCacheEvent(this.redis, {
        type: 'alert_recovered',
        severity: 'success',
        params: {
          rule: r.alert.rule,
          namespace: r.alert.namespace ?? '',
          minutes: Math.max(1, Math.round(r.durationMs / 60_000)),
        },
        runtime: null,
        at: now,
      });
    }
  }
}
