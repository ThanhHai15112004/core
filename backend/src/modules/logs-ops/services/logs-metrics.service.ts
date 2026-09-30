import { Injectable } from '@nestjs/common';
import {
  TELEMETRY_TIERS,
  tierCovering,
  type MetricBucket,
  type TelemetryTier,
} from '@packages/telemetry/index.js';
import { LOG_ENTRY_LEVELS, LOG_METRIC, type LogEntryLevel } from '@packages/logging/index.js';
import { PerformanceStoreService, counterOf, round } from '@modules/performance/index.js';

export interface LogWindow {
  tier: TelemetryTier;
  buckets: MetricBucket[];
  seconds: number;
  from: number;
  to: number;
}

const GROUP_PREFIX = 'log.eg.';
const MODULE_PREFIX = 'log.m.';
const MODULE_ERR_PREFIX = 'log.me.';

/** `api@host:pid` → `api`. */
export const runtimeOfInstance = (instance: string) => instance.split('@')[0] ?? instance;

/**
 * Số đo log từ telemetry (bucket 10s / 1m / 1h dùng chung với Performance): log theo level, byte, log mất, nhóm lỗi,
 * module. Giữ lâu hơn buffer log (tới 8 ngày ở tầng 1h) nên KPI / biểu đồ / nhóm lỗi không phụ thuộc buffer.
 */
@Injectable()
export class LogsMetricsService {
  constructor(private readonly perf: PerformanceStoreService) {}

  public async window(
    fromMs: number,
    toMs: number,
    now = Date.now(),
    forceTier?: TelemetryTier,
  ): Promise<LogWindow | null> {
    const tier = forceTier ?? tierCovering(fromMs, now);
    if (!tier || !this.perf.isAvailable()) return null;
    const instances = await this.perf
      .instances(fromMs - TELEMETRY_TIERS[tier].seconds * 1000)
      .catch(() => [] as string[]);
    const buckets = await this.perf
      .buckets(tier, fromMs, toMs, instances)
      .catch(() => [] as MetricBucket[]);
    return {
      tier,
      buckets,
      seconds: Math.max(1, (Math.min(toMs, now) - fromMs) / 1000),
      from: fromMs,
      to: toMs,
    };
  }

  public levelCounts(
    w: LogWindow | null,
    buckets = w?.buckets ?? [],
  ): Record<LogEntryLevel, number> {
    return Object.fromEntries(
      LOG_ENTRY_LEVELS.map((l) => [l, counterOf(buckets, LOG_METRIC.level(l))]),
    ) as Record<LogEntryLevel, number>;
  }

  public total(counts: Record<LogEntryLevel, number>): number {
    return Object.values(counts).reduce((a, b) => a + b, 0);
  }

  public counter(w: LogWindow | null, metric: string): number {
    return counterOf(w?.buckets ?? [], metric);
  }

  public perMin(w: LogWindow | null, n: number): number | null {
    return w ? round((n / w.seconds) * 60, 2) : null;
  }

  /** Theo runtime (instance `api@…`): tổng log, error, warn, số instance. */
  public bySource(w: LogWindow | null) {
    const out = new Map<
      string,
      { total: number; errors: number; warnings: number; instances: Set<string> }
    >();
    for (const b of w?.buckets ?? []) {
      for (const [instance, metrics] of b.byInstance) {
        let total = 0;
        let errors = 0;
        let warnings = 0;
        for (const l of LOG_ENTRY_LEVELS) {
          const c = metrics.get(LOG_METRIC.level(l))?.c ?? 0;
          total += c;
          if (l === 'error' || l === 'fatal') errors += c;
          if (l === 'warn') warnings += c;
        }
        if (total === 0) continue;
        const rt = runtimeOfInstance(instance);
        const s = out.get(rt) ?? { total: 0, errors: 0, warnings: 0, instances: new Set<string>() };
        s.total += total;
        s.errors += errors;
        s.warnings += warnings;
        s.instances.add(instance);
        out.set(rt, s);
      }
    }
    return out;
  }

  /** Byte log theo runtime (ước lượng kích thước ghi). */
  public bytesBySource(w: LogWindow | null): Map<string, number> {
    const out = new Map<string, number>();
    for (const b of w?.buckets ?? [])
      for (const [instance, metrics] of b.byInstance) {
        const c = metrics.get(LOG_METRIC.bytes)?.c ?? 0;
        if (c)
          out.set(runtimeOfInstance(instance), (out.get(runtimeOfInstance(instance)) ?? 0) + c);
      }
    return out;
  }

  /** Module (Nest context): tổng log và số error. */
  public byModule(w: LogWindow | null): Map<string, { total: number; errors: number }> {
    const out = new Map<string, { total: number; errors: number }>();
    for (const b of w?.buckets ?? [])
      for (const [metric, agg] of b.metrics) {
        const isErr = metric.startsWith(MODULE_ERR_PREFIX);
        if (!isErr && !metric.startsWith(MODULE_PREFIX)) continue;
        const name = metric.slice(isErr ? MODULE_ERR_PREFIX.length : MODULE_PREFIX.length);
        const m = out.get(name) ?? { total: 0, errors: 0 };
        if (isErr) m.errors += agg.c;
        else m.total += agg.c;
        out.set(name, m);
      }
    return out;
  }

  /** Số lần theo nhóm lỗi trong cửa sổ (fingerprint → count). */
  public byGroup(buckets: readonly MetricBucket[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const b of buckets)
      for (const [metric, agg] of b.metrics) {
        if (!metric.startsWith(GROUP_PREFIX) || agg.c === 0) continue;
        const fp = metric.slice(GROUP_PREFIX.length);
        out.set(fp, (out.get(fp) ?? 0) + agg.c);
      }
    return out;
  }

  /** Runtime ghi nhóm lỗi trong cửa sổ. */
  public groupRuntimes(buckets: readonly MetricBucket[], fp: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const b of buckets)
      for (const [instance, metrics] of b.byInstance) {
        const c = metrics.get(LOG_METRIC.group(fp))?.c ?? 0;
        if (c)
          out.set(runtimeOfInstance(instance), (out.get(runtimeOfInstance(instance)) ?? 0) + c);
      }
    return out;
  }

  /** Error / phút: cửa sổ gần nhất (`recentMin`) so với baseline ngay trước đó (`baselineMin`). */
  public rateChange(
    w: LogWindow | null,
    metricOf: (b: MetricBucket) => number,
    now: number,
    recentMin: number,
    baselineMin: number,
  ): { currentPerMin: number; baselinePerMin: number } | null {
    if (!w) return null;
    const recentFrom = now - recentMin * 60_000;
    const baseFrom = recentFrom - baselineMin * 60_000;
    let recent = 0;
    let base = 0;
    for (const b of w.buckets) {
      const v = metricOf(b);
      if (b.start >= recentFrom) recent += v;
      else if (b.start >= baseFrom) base += v;
    }
    return {
      currentPerMin: round(recent / recentMin, 2),
      baselinePerMin: round(base / baselineMin, 2),
    };
  }

  public errorsIn(b: MetricBucket): number {
    return (
      (b.metrics.get(LOG_METRIC.level('error'))?.c ?? 0) +
      (b.metrics.get(LOG_METRIC.level('fatal'))?.c ?? 0)
    );
  }

  public totalIn(b: MetricBucket): number {
    let t = 0;
    for (const l of LOG_ENTRY_LEVELS) t += b.metrics.get(LOG_METRIC.level(l))?.c ?? 0;
    return t;
  }
}
