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
  mergedOf,
  meanOf,
  percentileOf,
  round,
} from '@modules/performance/index.js';
import type { SchedulerReportDto } from '../responses/scheduler-ops.response.js';

export interface MetricWindow {
  tier: TelemetryTier;
  buckets: MetricBucket[];
  seconds: number;
}

/** `sch.<kind>` hoặc `sch.t.<taskId>.<kind>`. */
export const schMetric = (kind: string, taskId?: string | null) =>
  taskId ? `sch.t.${taskId}.${kind}` : `sch.${kind}`;

const r = (n: number | null) => (n === null ? null : round(n, 2));

/**
 * Số đo Scheduler do runtime ghi vào telemetry (bucket 10s/1m/1h dùng chung với trang Performance):
 * `sch.run|ok|fail|skip|miss|manual`, `sch.dur`, `sch.drift` và bản theo task `sch.t.<id>.*`.
 */
@Injectable()
export class SchedulerMetricsService {
  constructor(private readonly perf: PerformanceStoreService) {}

  public async window(
    fromMs: number,
    toMs: number,
    now: number,
    forceTier?: TelemetryTier,
  ): Promise<MetricWindow | null> {
    const tier = forceTier ?? tierCovering(fromMs, now);
    if (!tier || !this.perf.isAvailable()) return null;
    const instances = await this.perf
      .instances(fromMs - TELEMETRY_TIERS[tier].seconds * 1000)
      .catch(() => [] as string[]);
    const buckets = await this.perf.buckets(tier, fromMs, toMs, instances).catch(() => []);
    return { tier, buckets, seconds: Math.max(1, (Math.min(toMs, now) - fromMs) / 1000) };
  }

  public count(w: MetricWindow | null, kind: string, taskId?: string | null): number {
    return counterOf(w?.buckets ?? [], schMetric(kind, taskId));
  }

  public duration(w: MetricWindow | null, taskId?: string | null) {
    const agg = mergedOf(w?.buckets ?? [], schMetric('dur', taskId));
    return { avgMs: r(meanOf(agg)), p95Ms: r(percentileOf(agg, 95)), samples: agg.n };
  }

  public drift(w: MetricWindow | null) {
    const agg = mergedOf(w?.buckets ?? [], 'sch.drift');
    return { avgMs: r(meanOf(agg)), p95Ms: r(percentileOf(agg, 95)), samples: agg.n };
  }

  public report(w: MetricWindow | null): SchedulerReportDto {
    const ok = this.count(w, 'ok');
    const failed = this.count(w, 'fail');
    const d = this.duration(w);
    return {
      executions: this.count(w, 'run'),
      successful: ok,
      failed,
      skipped: this.count(w, 'skip'),
      missed: this.count(w, 'miss'),
      successRatePercent: ok + failed > 0 ? round((ok / (ok + failed)) * 100, 2) : null,
      avgDurationMs: d.avgMs,
      p95DurationMs: d.p95Ms,
      manualRuns: this.count(w, 'manual'),
    };
  }
}
