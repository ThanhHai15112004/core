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

/** Tổng hợp số đo query/transaction/pool của database trong một khoảng (từ bucket của MetricRecorder). */
export interface DbWindowStats {
  queries: number;
  queriesPerSec: number | null;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  failed: number;
  errorRatePercent: number | null;
  slow: number;
  committed: number;
  rolledBack: number;
  txAvgMs: number | null;
  deadlocks: number;
  poolPeak: number | null;
}

/** Đọc số đo database đã ghi trong Redis (dùng chung bucket với trang Performance). */
@Injectable()
export class DatabaseMetricsService {
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

  public async liveInstances(sinceMs: number): Promise<string[]> {
    return this.perf.instances(sinceMs).catch(() => []);
  }

  public stats(w: MetricWindow | null): DbWindowStats {
    const b = w?.buckets ?? [];
    const q = mergedOf(b, 'db.query');
    const failed = counterOf(b, 'db.errors');
    const tx = mergedOf(b, 'db.tx.duration');
    const r = (n: number | null, d = 2) => (n === null ? null : round(n, d));
    return {
      queries: q.n,
      queriesPerSec: w && q.n > 0 ? round(q.n / w.seconds, 3) : w ? 0 : null,
      avgMs: r(meanOf(q)),
      p50Ms: r(percentileOf(q, 50)),
      p95Ms: r(percentileOf(q, 95)),
      p99Ms: r(percentileOf(q, 99)),
      failed,
      errorRatePercent: q.n > 0 ? round((failed / q.n) * 100) : null,
      slow: counterOf(b, 'db.slow'),
      committed: counterOf(b, 'db.tx.committed'),
      rolledBack: counterOf(b, 'db.tx.rolledback'),
      txAvgMs: r(meanOf(tx)),
      deadlocks: counterOf(b, 'db.err.deadlock'),
      poolPeak: gaugeWindow(b, 'db.pool.used').peak,
    };
  }
}
