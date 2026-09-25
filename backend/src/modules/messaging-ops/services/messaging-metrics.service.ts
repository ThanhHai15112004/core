import { Injectable } from '@nestjs/common';
import {
  TELEMETRY_TIERS,
  tierCovering,
  type MetricBucket,
  type TelemetryTier,
} from '@packages/telemetry/index.js';
import { channelMetric } from '@packages/messaging/index.js';
import {
  PerformanceStoreService,
  counterOf,
  gaugeWindow,
  mergedOf,
  meanOf,
  percentileOf,
  round,
} from '@modules/performance/index.js';
import type { DeliveryDto } from '../responses/messaging-ops.response.js';

export interface MetricWindow {
  tier: TelemetryTier;
  buckets: MetricBucket[];
  seconds: number;
}

const r = (n: number | null, d = 2) => (n === null ? null : round(n, d));
const rate = (part: number, total: number) => (total > 0 ? round((part / total) * 100, 2) : null);

/** Đọc số đo messaging đã ghi trong Redis (dùng chung bucket với trang Performance). */
@Injectable()
export class MessagingMetricsService {
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

  public perSec(w: MetricWindow | null, n: number): number | null {
    return w ? round(n / w.seconds, 3) : null;
  }

  public delivery(w: MetricWindow | null): DeliveryDto {
    const b = w?.buckets ?? [];
    const consumed = counterOf(b, 'msg.consumed');
    const failed = counterOf(b, 'msg.consume.failed');
    return {
      published: counterOf(b, 'msg.published'),
      consumed,
      failed,
      retried: counterOf(b, 'msg.retry'),
      deadLettered: counterOf(b, 'msg.dlq'),
      recovered: counterOf(b, 'msg.recovered'),
      publishFailures: counterOf(b, 'msg.publish.failed'),
      failureRatePercent: rate(failed, consumed + failed),
    };
  }

  public processing(w: MetricWindow | null, runtime?: string) {
    const agg = mergedOf(w?.buckets ?? [], 'msg.process', runtime);
    return {
      avgMs: r(meanOf(agg)),
      p95Ms: r(percentileOf(agg, 95)),
      p99Ms: r(percentileOf(agg, 99)),
    };
  }

  /** Kích thước message (gauge `msg.size`): trung bình và lớn nhất trong cửa sổ. */
  public payload(w: MetricWindow | null, channel?: string) {
    const agg = mergedOf(w?.buckets ?? [], channel ? channelMetric(channel, 'size') : 'msg.size');
    return { avgBytes: agg.n > 0 ? Math.round(agg.s / agg.n) : null, maxBytes: agg.x };
  }

  public channel(w: MetricWindow | null, name: string) {
    const b = w?.buckets ?? [];
    const c = (k: string) => counterOf(b, channelMetric(name, k));
    const proc = mergedOf(b, channelMetric(name, 'proc'));
    const consumed = c('con');
    const failed = c('fail');
    return {
      published: c('pub'),
      consumed,
      failed,
      retried: c('retry'),
      deadLettered: c('dlq'),
      publishFailures: c('pubfail'),
      failureRatePercent: rate(failed, consumed + failed),
      avgMs: r(meanOf(proc)),
      p95Ms: r(percentileOf(proc, 95)),
      avgSizeBytes: this.payload(w, name).avgBytes,
    };
  }

  /** Publish của một producer (runtime) — tổng và theo channel. */
  public producer(w: MetricWindow | null, runtime: string, channels: string[]) {
    const b = w?.buckets ?? [];
    return {
      published: counterOf(b, 'msg.published', runtime),
      failures: counterOf(b, 'msg.publish.failed', runtime),
      channels: channels.map((ch) => ({
        channel: ch,
        published: counterOf(b, channelMetric(ch, 'pub'), runtime),
      })),
    };
  }

  /** Tiêu thụ của consumer chạy trong `runtime`. */
  public consumer(w: MetricWindow | null, runtime: string | undefined) {
    const b = w?.buckets ?? [];
    const consumed = counterOf(b, 'msg.consumed', runtime);
    const failed = counterOf(b, 'msg.consume.failed', runtime);
    return {
      consumed,
      failed,
      retried: counterOf(b, 'msg.retry', runtime),
      recovered: counterOf(b, 'msg.recovered', runtime),
      deadLettered: counterOf(b, 'msg.dlq', runtime),
      failureRatePercent: rate(failed, consumed + failed),
      ...this.processing(w, runtime),
    };
  }

  /** Lag tổng (gauge do monitor nền ghi). */
  public lag(w: MetricWindow | null) {
    return gaugeWindow(w?.buckets ?? [], 'msg.lag', { mode: 'max' });
  }
}
