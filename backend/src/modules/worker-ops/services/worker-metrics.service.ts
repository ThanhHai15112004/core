import { Injectable } from '@nestjs/common';
import {
  TELEMETRY_TIERS,
  tierCovering,
  type MetricBucket,
  type TelemetryTier,
} from '@packages/telemetry/index.js';
import { jobMetric } from '@packages/messaging/index.js';
import {
  PerformanceStoreService,
  counterOf,
  gaugeOf,
  gaugeWindow,
  mergedOf,
  meanOf,
  percentileOf,
  round,
} from '@modules/performance/index.js';
import type { DurationStatsDto } from '../responses/worker-ops.response.js';

export interface MetricWindow {
  tier: TelemetryTier;
  buckets: MetricBucket[];
  seconds: number;
}

/** Số đo job theo cửa sổ: nhận vào, xong, lỗi, retry, hết lượt thử. */
export interface JobCounts {
  incoming: number;
  completed: number;
  failed: number;
  retried: number;
  exhausted: number;
  recovered: number;
  failureRatePercent: number | null;
}

const r = (n: number | null, d = 2) => (n === null ? null : round(n, d));
const rate = (part: number, total: number) => (total > 0 ? round((part / total) * 100, 2) : null);
/** `wq.<kind>` hoặc `wq.q.<queue>.<kind>`. */
const key = (kind: string, queue?: string | null) =>
  queue ? jobMetric(queue, kind) : `wq.${kind}`;

/** Tổng counter của đúng một instance (`worker@host:pid`) trong cửa sổ. */
export function instanceCounter(
  buckets: readonly MetricBucket[],
  metric: string,
  instance: string,
) {
  let c = 0;
  for (const b of buckets) c += b.byInstance.get(instance)?.get(metric)?.c ?? 0;
  return c;
}

/** Gauge gần nhất của một instance (bucket muộn nhất có dữ liệu). */
export function instanceGauge(buckets: readonly MetricBucket[], metric: string, instance: string) {
  for (let i = buckets.length - 1; i >= 0; i--) {
    const v = gaugeOf(buckets[i]!, metric, { instance });
    if (v !== null) return v;
  }
  return null;
}

/**
 * Đọc số đo công việc nền đã ghi trong Redis (dùng chung bucket với trang Performance): `wq.*` do consumer
 * (worker) và publisher ghi, gauge độ sâu queue do monitor nền ghi.
 */
@Injectable()
export class WorkerMetricsService {
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

  public perMin(w: MetricWindow | null, n: number): number | null {
    return w ? round((n / w.seconds) * 60, 2) : null;
  }

  public counts(w: MetricWindow | null, queue?: string | null): JobCounts {
    const b = w?.buckets ?? [];
    const c = (kind: string) => counterOf(b, key(kind, queue));
    const completed = c('done');
    const failed = c('fail');
    return {
      incoming: c('in'),
      completed,
      failed,
      retried: c('retry'),
      exhausted: c('exhausted'),
      // Chỉ có bộ đếm toàn cục (không tách theo queue).
      recovered: queue ? 0 : c('recovered'),
      failureRatePercent: rate(failed, completed + failed),
    };
  }

  /** Thời gian xử lý (job thành công) — trung bình và phân vị. */
  public processing(
    w: MetricWindow | null,
    queue?: string | null,
    runtime?: string,
  ): DurationStatsDto {
    const agg = mergedOf(w?.buckets ?? [], key('proc', queue), runtime);
    return {
      avgMs: r(meanOf(agg)),
      p50Ms: r(percentileOf(agg, 50)),
      p95Ms: r(percentileOf(agg, 95)),
      p99Ms: r(percentileOf(agg, 99)),
    };
  }

  /** Thời gian chờ trong queue (tạo job → worker nhận). */
  public wait(w: MetricWindow | null, queue?: string | null) {
    const agg = mergedOf(w?.buckets ?? [], key('wait', queue));
    return { avgMs: r(meanOf(agg)), p95Ms: r(percentileOf(agg, 95)) };
  }

  /** Độ sâu queue (gauge do monitor nền ghi) — đỉnh và giá trị theo thời gian. */
  public waiting(w: MetricWindow | null, queue?: string | null) {
    return gaugeWindow(w?.buckets ?? [], key('waiting', queue), { mode: 'max' });
  }
}
