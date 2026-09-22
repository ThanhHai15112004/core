import { Injectable } from '@nestjs/common';
import {
  TELEMETRY_TIERS,
  tierCovering,
  type MetricBucket,
  type TelemetryTier,
} from '@packages/telemetry/index.js';
import {
  PerformanceStoreService,
  counterOf,
  gaugeWindow,
  mergedOf,
  meanOf,
  percentileOf,
  round,
} from '@modules/performance/index.js';

export interface MetricWindow {
  tier: TelemetryTier;
  buckets: MetricBucket[];
  /** Số giây thực tế (tới hiện tại). */
  seconds: number;
}

/** Tổng hợp số đo cache trong một khoảng (từ bucket của MetricRecorder). */
export interface CacheWindowStats {
  hits: number;
  misses: number;
  reads: number;
  sets: number;
  deletes: number;
  hitRatePercent: number | null;
  missRatePercent: number | null;
  opsPerSec: number | null;
  getsPerSec: number | null;
  setsPerSec: number | null;
  deletesPerSec: number | null;
  avgOpMs: number | null;
  p95OpMs: number | null;
  errors: number;
  /** Toàn Redis server (delta do collector ghi). */
  evicted: number | null;
  expired: number | null;
  rejected: number | null;
  peakServerMemory: number | null;
  peakCacheBytes: number | null;
  peakKeys: number | null;
}

export interface NamespaceCounters {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
}

const NS_PREFIX = 'cache.ns.';
const KINDS = { hit: 'hits', miss: 'misses', set: 'sets', del: 'deletes' } as const;

/** Gauge của collector (một instance ghi mỗi chu kỳ) → đọc theo max để không cộng trùng giữa instance. */
export const collectorGauge = (buckets: readonly MetricBucket[], metric: string) =>
  gaugeWindow(buckets, metric, { mode: 'max' });

export const hitRate = (hits: number, reads: number) =>
  reads > 0 ? round((hits / reads) * 100, 2) : null;

/** Đọc số đo cache đã ghi trong Redis (dùng chung bucket với trang Performance). */
@Injectable()
export class CacheMetricsService {
  constructor(private readonly perf: PerformanceStoreService) {}

  public async window(
    fromMs: number,
    toMs: number,
    now: number,
    forceTier?: TelemetryTier,
  ): Promise<MetricWindow | null> {
    const tier = forceTier ?? tierCovering(fromMs, now);
    if (!tier) return null;
    const instances = await this.perf
      .instances(fromMs - TELEMETRY_TIERS[tier].seconds * 1000)
      .catch(() => [] as string[]);
    const buckets = await this.perf.buckets(tier, fromMs, toMs, instances);
    return { tier, buckets, seconds: Math.max(1, (Math.min(toMs, now) - fromMs) / 1000) };
  }

  public stats(w: MetricWindow | null): CacheWindowStats {
    const b = w?.buckets ?? [];
    const hits = counterOf(b, 'cache.hit');
    const misses = counterOf(b, 'cache.miss');
    const sets = counterOf(b, 'cache.set');
    const deletes = counterOf(b, 'cache.del');
    const reads = hits + misses;
    const op = mergedOf(b, 'cache.op');
    const perSec = (n: number) => (w ? round(n / w.seconds, 3) : null);
    const r = (n: number | null, d = 2) => (n === null ? null : round(n, d));
    // Số liệu server chỉ có khi collector đã đọc được INFO (driver redis) trong cửa sổ.
    const hasServer = b.some((x) => x.metrics.has('redis.used'));
    const serverCounter = (name: string) => (hasServer ? counterOf(b, name) : null);
    return {
      hits,
      misses,
      reads,
      sets,
      deletes,
      hitRatePercent: hitRate(hits, reads),
      missRatePercent: reads > 0 ? round((misses / reads) * 100, 2) : null,
      opsPerSec: perSec(reads + sets + deletes),
      getsPerSec: perSec(reads),
      setsPerSec: perSec(sets),
      deletesPerSec: perSec(deletes),
      avgOpMs: r(meanOf(op), 3),
      p95OpMs: r(percentileOf(op, 95), 3),
      errors: counterOf(b, 'cache.errors'),
      evicted: serverCounter('redis.evicted'),
      expired: serverCounter('redis.expired'),
      rejected: serverCounter('redis.rejected'),
      peakServerMemory: collectorGauge(b, 'redis.used').peak,
      peakCacheBytes: collectorGauge(b, 'cache.bytes').peak,
      peakKeys: collectorGauge(b, 'cache.keys').peak,
    };
  }

  /** Bộ đếm hit/miss/set/del theo namespace trong cửa sổ. */
  public namespaces(w: MetricWindow | null): Map<string, NamespaceCounters> {
    const out = new Map<string, NamespaceCounters>();
    for (const bucket of w?.buckets ?? []) {
      for (const [name, agg] of bucket.metrics) {
        if (!name.startsWith(NS_PREFIX)) continue;
        const dot = name.lastIndexOf('.');
        const kind = name.slice(dot + 1) as keyof typeof KINDS;
        const field = KINDS[kind];
        if (!field) continue;
        const ns = name.slice(NS_PREFIX.length, dot);
        const acc = out.get(ns) ?? { hits: 0, misses: 0, sets: 0, deletes: 0 };
        acc[field] += agg.c;
        out.set(ns, acc);
      }
    }
    return out;
  }
}
