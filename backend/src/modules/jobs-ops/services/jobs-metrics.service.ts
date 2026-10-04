import { Injectable } from '@nestjs/common';
import { MAX_TRACKED_CHANNELS, jobMetric } from '@packages/messaging/index.js';
import type { MetricBucket } from '@modules/system-ops/telemetry-compat.js';
import { counterOf, mergedOf, meanOf, percentileOf, round } from '@modules/performance/index.js';
import { WorkerMetricsService, type MetricWindow } from '@modules/worker-ops/index.js';
import type { JobTypeRowDto, JobsReportDto } from '../responses/jobs-ops.response.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const TYPE_TTL_MS = 5 * MINUTE;
const WAIT_TTL_MS = MINUTE;
/** `msg.ch.<loại job>.<kind>` — số đo theo loại job (topic) do publisher / consumer ghi. */
const CHANNEL_METRIC = /^msg\.ch\.(.+)\.(pub|con|fail|proc|dlq|retry)$/;

const r2 = (n: number | null) => (n === null ? null : round(n, 2));
const rate = (part: number, total: number) => (total > 0 ? round((part / total) * 100, 2) : null);
const channelKey = (type: string, kind: string) => `msg.ch.${type.replace(/\|/g, '_')}.${kind}`;

/** Tên loại job có số đo trong cửa sổ. */
export function typesIn(buckets: readonly MetricBucket[]): string[] {
  const out = new Set<string>();
  for (const b of buckets)
    for (const name of b.metrics.keys()) {
      const m = CHANNEL_METRIC.exec(name);
      if (m) out.add(m[1]!);
    }
  return [...out];
}

/**
 * Số đo job theo thời gian (dùng chung bucket telemetry với Worker & Queue / Messaging): báo cáo hôm nay / hôm qua,
 * hiệu năng theo loại job, và baseline (p95 theo loại job, thời gian chờ trung bình theo queue) để nhận diện job chạy
 * lâu / chờ lâu bất thường. Baseline đổi chậm nên giữ trong bộ nhớ ngắn hạn.
 */
@Injectable()
export class JobsMetricsService {
  private typeCache: { at: number; values: Map<string, number> } | null = null;
  private waitCache: { at: number; values: Map<string, number> } | null = null;

  constructor(private readonly metrics: WorkerMetricsService) {}

  public window(from: number, to: number, now: number, tier?: 's10') {
    return this.metrics.window(from, to, now, tier);
  }

  /** p95 thời gian xử lý (job thành công) của từng loại job trong 24 giờ. */
  public async typicalByType(now: number): Promise<Map<string, number>> {
    if (this.typeCache && now - this.typeCache.at < TYPE_TTL_MS) return this.typeCache.values;
    const w = await this.metrics.window(now - DAY, now, now).catch(() => null);
    const b = w?.buckets ?? [];
    const values = new Map<string, number>();
    for (const type of typesIn(b)) {
      const p95 = percentileOf(mergedOf(b, channelKey(type, 'proc')), 95);
      if (p95 !== null) values.set(type, p95);
    }
    this.typeCache = { at: now, values };
    return values;
  }

  /** Thời gian chờ trung bình 1 giờ qua theo queue (`*` = mọi queue). */
  public async waitByQueue(now: number, queues: string[]): Promise<Map<string, number>> {
    if (this.waitCache && now - this.waitCache.at < WAIT_TTL_MS) return this.waitCache.values;
    const w = await this.metrics.window(now - 60 * MINUTE, now, now).catch(() => null);
    const b = w?.buckets ?? [];
    const values = new Map<string, number>();
    const all = meanOf(mergedOf(b, 'wq.wait'));
    if (all !== null) values.set('*', all);
    for (const q of queues) {
      const v = meanOf(mergedOf(b, jobMetric(q, 'wait')));
      if (v !== null) values.set(q, v);
    }
    this.waitCache = { at: now, values };
    return values;
  }

  public report(w: MetricWindow | null): JobsReportDto {
    const b = w?.buckets ?? [];
    const completed = counterOf(b, 'wq.done');
    const failed = counterOf(b, 'wq.exhausted');
    const proc = mergedOf(b, 'wq.proc');
    return {
      created: counterOf(b, 'wq.in'),
      completed,
      failed,
      retried: counterOf(b, 'wq.retry'),
      cancelled: counterOf(b, 'wq.cancelled'),
      successRatePercent: rate(completed, completed + failed),
      avgWaitMs: r2(meanOf(mergedOf(b, 'wq.wait'))),
      avgProcessingMs: r2(meanOf(proc)),
      p95ProcessingMs: r2(percentileOf(proc, 95)),
    };
  }

  /** Hiệu năng theo loại job: số lần chạy, lỗi, trung bình / p95 thời gian xử lý. */
  public types(w: MetricWindow | null): JobTypeRowDto[] {
    const b = w?.buckets ?? [];
    return typesIn(b)
      .map((type) => {
        const ok = counterOf(b, channelKey(type, 'con'));
        const failed = counterOf(b, channelKey(type, 'fail'));
        const proc = mergedOf(b, channelKey(type, 'proc'));
        return {
          type,
          created: counterOf(b, channelKey(type, 'pub')),
          runs: ok + failed,
          failed,
          failureRatePercent: rate(failed, ok + failed),
          avgMs: r2(meanOf(proc)),
          p95Ms: r2(percentileOf(proc, 95)),
        };
      })
      .filter((t) => t.created + t.runs > 0)
      .sort((a, b) => b.runs - a.runs || b.created - a.created || a.type.localeCompare(b.type));
  }

  public get trackedTypes(): number {
    return MAX_TRACKED_CHANNELS;
  }
}
